import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  archiveRoom,
  createRoom,
  deleteRoom,
  getRoom,
  listRooms,
  postToRoom,
  renameRoom,
  resetRoomIdsForTests,
  roomsPath,
  sanitizePeerRelay,
  updateRoomMembers,
} from '../src/runtime/rooms'
import { emptyThreads, needsFanoutConfirm, resetIdsForTests, staffWithSisters } from '../src/domain'
import {
  confirmRoomPost,
  dismissRoomPost,
  peerProvenanceForHop,
  send,
  sendToAgent,
  sendToRoom,
  turnKickoff,
  turnOriginUser,
  type Session,
} from '../src/session'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-rooms-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(home, { recursive: true })
  return home
}

function fresh(): Session {
  resetIdsForTests()
  const agents = staffWithSisters()
  return {
    agents,
    activeAgentId: 'staff',
    threads: emptyThreads(agents),
    jobs: [],
    pendingFanout: null,
  }
}

describe('rooms CRUD', () => {
  test('create list rename members archive delete persist under rooms.json', () => {
    resetRoomIdsForTests()
    const home = tmpHome()
    expect(listRooms(home)).toEqual([])

    const room = createRoom({ name: 'Ship', memberIds: ['staff', 'kernel'] }, home, () => '2026-09-12T00:00:00.000Z')
    expect(room.name).toBe('Ship')
    expect(room.memberIds).toEqual(['staff', 'kernel'])
    expect(existsSync(roomsPath(home))).toBe(true)
    expect(listRooms(home)).toHaveLength(1)
    expect(getRoom(room.id, home)?.name).toBe('Ship')

    const renamed = renameRoom(room.id, 'Release', home, () => '2026-09-12T01:00:00.000Z')
    expect(renamed?.name).toBe('Release')
    expect(renamed?.updatedAt).toBe('2026-09-12T01:00:00.000Z')

    const seated = updateRoomMembers(room.id, ['staff', 'kernel', 'research'], home)
    expect(seated?.memberIds).toEqual(['staff', 'kernel', 'research'])

    const archived = archiveRoom(room.id, home)
    expect(archived?.archived).toBe(true)
    expect(listRooms(home)).toHaveLength(0)
    expect(listRooms(home, { includeArchived: true })).toHaveLength(1)

    expect(deleteRoom(room.id, home)).toBe(true)
    expect(getRoom(room.id, home)).toBeNull()
    const disk = existsSync(roomsPath(home)) ? readFileSync(roomsPath(home), 'utf8') : '[]'
    expect(disk).not.toContain('Release')
    rmSync(home, { recursive: true, force: true })
  })

  test('postToRoom fans deliveries to members excluding sender', () => {
    resetRoomIdsForTests()
    const home = tmpHome()
    const room = createRoom(
      { name: 'War room', memberIds: ['staff', 'kernel', 'research'] },
      home,
    )
    const posted = postToRoom(room.id, { fromId: 'staff', text: 'Status check' }, home)
    expect(posted.deliveries.map((row) => row.toId).sort()).toEqual(['kernel', 'research'])
    expect(posted.deliveries.every((row) => row.text === 'Status check')).toBe(true)
    expect(posted.sentRelayText).toContain('War room')
    expect(() => postToRoom(room.id, { fromId: 'staff', text: '   ' }, home)).toThrow()
    archiveRoom(room.id, home)
    expect(() => postToRoom(room.id, { fromId: 'staff', text: 'nope' }, home)).toThrow(/archived/i)
    rmSync(home, { recursive: true, force: true })
  })

  test('sanitizePeerRelay strips obvious vent phrasing', () => {
    expect(sanitizePeerRelay('just between us, check the PR')).toBe('check the PR')
    expect(sanitizePeerRelay('venting: the build is red')).toBe('the build is red')
  })
})

describe('sendToAgent / sendToRoom session', () => {
  test('sendToAgent is async ack — notes wake target, no reply yet', () => {
    let s = fresh()
    s = sendToAgent(s, 'staff', 'kernel', 'Please look at the open PRs')
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Sent.')).toBe(
      true,
    )
    expect(s.threads.staff.items.some((item) => item.kind === 'relay' && item.lane === 'sent' && item.peerId === 'kernel')).toBe(
      true,
    )
    const note = s.threads.kernel.items.find((item) => item.kind === 'agent_note')
    expect(note?.kind === 'agent_note' && note.fromId === 'staff' && note.text.includes('open PRs')).toBe(true)
    expect(s.threads.kernel.mouth).toBe('answer')
    expect(turnKickoff(s, 'kernel')).toBe('peer-hop')
    // No sister spoken reply yet (async)
    expect(s.threads.kernel.items.some((item) => item.kind === 'msg' && item.from === 'agent')).toBe(false)
    // Empty no-op
    const same = sendToAgent(s, 'staff', 'kernel', '   ')
    expect(same).toBe(s)
  })

  test('sendToAgent propagates originUser + hopDepth on peer-hop wake', () => {
    let s = fresh()
    s = send(s, 'Please look at the open PRs')
    expect(turnKickoff(s, 'staff')).toBe('user')
    expect(turnOriginUser(s, 'staff')).toBe(true)
    const prov = peerProvenanceForHop(s, 'staff')
    expect(prov).toEqual({ originUser: true, hopDepth: 1 })
    s = sendToAgent(s, 'staff', 'kernel', 'Please look at the open PRs')
    const wake = [...s.threads.kernel.items].reverse().find((item) => item.kind === 'msg' && item.from === 'user')
    expect(wake?.kind === 'msg' && wake.kickoff === 'peer-hop').toBe(true)
    expect(wake?.kind === 'msg' && wake.originUser === true).toBe(true)
    expect(wake?.kind === 'msg' && wake.hopDepth === 1).toBe(true)
    expect(turnOriginUser(s, 'kernel')).toBe(true)
    // Second hop increments depth and keeps originUser
    s = sendToAgent(s, 'kernel', 'research', 'Relay the PR look')
    const second = [...s.threads.research.items].reverse().find((item) => item.kind === 'msg' && item.from === 'user')
    expect(second?.kind === 'msg' && second.kickoff === 'peer-hop').toBe(true)
    expect(second?.kind === 'msg' && second.originUser === true).toBe(true)
    expect(second?.kind === 'msg' && second.hopDepth === 2).toBe(true)
  })

  test('sendToAgent without interactive person keeps originUser false', () => {
    let s = fresh()
    // No user send on staff — peer hop has nobody watching
    s = sendToAgent(s, 'staff', 'kernel', 'Ghost hop')
    const wake = [...s.threads.kernel.items].reverse().find((item) => item.kind === 'msg' && item.from === 'user')
    expect(wake?.kind === 'msg' && wake.kickoff === 'peer-hop').toBe(true)
    expect(wake?.kind === 'msg' && wake.originUser).toBeUndefined()
    expect(wake?.kind === 'msg' && wake.hopDepth === 1).toBe(true)
    expect(turnOriginUser(s, 'kernel')).toBe(false)
  })

  test('sendToRoom posts agent_notes on each member thread separately', () => {
    resetRoomIdsForTests()
    const home = tmpHome()
    const room = createRoom(
      { name: 'Desk', memberIds: ['staff', 'kernel', 'research'] },
      home,
    )
    let s = fresh()
    s = send(s, 'Sync the desk')
    s = sendToRoom(s, room.id, 'staff', 'Sync at noon', { home })
    expect(s.threads.staff.items.some((item) => item.kind === 'msg' && item.from === 'agent' && item.text === 'Sent.')).toBe(
      true,
    )
    expect(s.threads.kernel.items.some((item) => item.kind === 'agent_note' && item.text.includes('Desk'))).toBe(true)
    expect(s.threads.research.items.some((item) => item.kind === 'agent_note' && item.text.includes('Desk'))).toBe(true)
    expect(s.threads.kernel.mouth).toBe('answer')
    expect(s.threads.research.mouth).toBe('answer')
    expect(turnKickoff(s, 'kernel')).toBe('peer-hop')
    const kernelWake = [...s.threads.kernel.items].reverse().find((item) => item.kind === 'msg' && item.from === 'user')
    expect(kernelWake?.kind === 'msg' && kernelWake.originUser === true && kernelWake.hopDepth === 1).toBe(true)
    // Separate threads — not one collapsed transcript
    expect(s.threads.kernel.items).not.toEqual(s.threads.research.items)
    // postToRoom itself propagates provenance on deliveries
    const posted = postToRoom(
      room.id,
      { fromId: 'staff', text: 'Again', originUser: true, hopDepth: 3 },
      home,
    )
    expect(posted.deliveries.every((row) => row.originUser === true && row.hopDepth === 3)).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })

  test('sendToRoom respects needsFanoutConfirm when requireFanoutConfirm', () => {
    resetRoomIdsForTests()
    const home = tmpHome()
    // staff + three sisters would need a fourth agent — use staff/kernel/research and add a fake seat
    resetIdsForTests()
    const agents = [
      ...staffWithSisters(),
      {
        id: 'marionette',
        name: 'Marionette',
        title: 'Code',
        description: '',
        color: '#888',
        hidden: false,
      },
    ]
    const room = createRoom(
      { name: 'All hands', memberIds: ['staff', 'kernel', 'research', 'marionette'] },
      home,
    )
    let s: Session = {
      agents,
      activeAgentId: 'staff',
      threads: emptyThreads(agents),
      jobs: [],
      pendingFanout: null,
    }
    const targets = ['kernel', 'research', 'marionette']
    expect(needsFanoutConfirm(targets)).toBe(true)
    s = sendToRoom(s, room.id, 'staff', 'Hello all', { home, requireFanoutConfirm: true })
    expect(s.pendingRoomPost?.targets).toEqual(targets)
    expect(s.threads.kernel.items.some((item) => item.kind === 'agent_note')).toBe(false)
    s = confirmRoomPost(s)
    expect(s.pendingRoomPost).toBeNull()
    expect(s.threads.kernel.items.some((item) => item.kind === 'agent_note')).toBe(true)
    expect(s.threads.marionette.items.some((item) => item.kind === 'agent_note')).toBe(true)

    s = fresh()
    s = {
      ...s,
      agents,
      threads: emptyThreads(agents),
      pendingRoomPost: { roomId: room.id, fromId: 'staff', text: 'x', targets },
    }
    s = dismissRoomPost(s)
    expect(s.pendingRoomPost).toBeNull()
    rmSync(home, { recursive: true, force: true })
  })
})
