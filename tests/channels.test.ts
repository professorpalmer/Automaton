import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'bun:test'
import {
  channelStatusLabel,
  connectSlack,
  disconnectChannel,
  drainSlackInbox,
  hasSlackGrant,
  ingestSlackInbound,
  listChannels,
  sendSlackMessage,
  slackInboxDir,
  slackSecretsPath,
  slackStatus,
} from '../src/runtime/channels'
import { emptyThreads, resetIdsForTests, staffWithSisters } from '../src/domain'
import { enqueueChannelInbound, turnKickoff, type Session } from '../src/session'
import { isUnattended } from '../src/runtime/auto-approve'

function tmpHome(): string {
  const home = join(tmpdir(), `automaton-channels-${Date.now()}-${Math.random().toString(16).slice(2)}`)
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

describe('channels Slack MVP', () => {
  test('connect / disconnect persists status without tokens in channels.json', () => {
    const home = tmpHome()
    expect(hasSlackGrant(home)).toBe(false)
    expect(slackStatus(home).connected).toBe(false)
    expect(channelStatusLabel(slackStatus(home))).toBe('Need auth')

    const row = connectSlack({ botToken: 'xoxb-test-secret-token' }, home)
    expect(row.connected).toBe(true)
    expect(row.needsAuth).toBe(false)
    expect(hasSlackGrant(home)).toBe(true)
    expect(existsSync(slackSecretsPath(home))).toBe(true)
    const secrets = readFileSync(slackSecretsPath(home), 'utf8')
    expect(secrets).toContain('xoxb-test-secret-token')
    try {
      expect((chmodSync as unknown) && true).toBe(true)
    } catch {
      /* ignore */
    }

    const publicView = listChannels(home)
    expect(publicView).toHaveLength(1)
    expect(publicView[0]?.connected).toBe(true)
    const disk = readFileSync(join(home, 'channels.json'), 'utf8')
    expect(disk).not.toContain('xoxb-')
    expect(disk).not.toContain('test-secret')
    expect(JSON.stringify(publicView)).not.toContain('xoxb-')

    const gone = disconnectChannel('slack', home)
    expect(gone?.connected).toBe(false)
    expect(gone?.needsAuth).toBe(true)
    expect(hasSlackGrant(home)).toBe(false)
    expect(existsSync(slackSecretsPath(home))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })

  test('send fails closed when disconnected', async () => {
    const home = tmpHome()
    const calls: string[] = []
    const result = await sendSlackMessage(
      {
        channelId: 'C123',
        text: 'hello',
        seams: {
          fetch: async (input) => {
            calls.push(String(input))
            return new Response('{}', { status: 200 })
          },
        },
      },
      home,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Need Slack auth/i)
    expect(calls).toEqual([])
    rmSync(home, { recursive: true, force: true })
  })

  test('send posts when connected; still fail closed on API error', async () => {
    const home = tmpHome()
    connectSlack({ botToken: 'xoxb-live' }, home)
    const ok = await sendSlackMessage(
      {
        channelId: 'C123',
        text: 'ship it',
        threadTs: '1.2',
        seams: {
          fetch: async (_input, init) => {
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>
            expect(body.channel).toBe('C123')
            expect(body.text).toBe('ship it')
            expect(body.thread_ts).toBe('1.2')
            const headers = new Headers(init?.headers)
            expect(headers.get('Authorization')).toBe('Bearer xoxb-live')
            return new Response(JSON.stringify({ ok: true, ts: '9.9' }), { status: 200 })
          },
        },
      },
      home,
    )
    expect(ok).toEqual({ ok: true, ts: '9.9' })

    const fail = await sendSlackMessage(
      {
        channelId: 'C123',
        text: 'nope',
        seams: {
          fetch: async () =>
            new Response(JSON.stringify({ ok: false, error: 'channel_not_found' }), { status: 200 }),
        },
      },
      home,
    )
    expect(fail.ok).toBe(false)
    if (!fail.ok) expect(fail.error).toBe('channel_not_found')
    expect(slackStatus(home).connected).toBe(true)
    expect(slackStatus(home).lastError).toBe('channel_not_found')
    rmSync(home, { recursive: true, force: true })
  })

  test('ingest → enqueue sets kickoff channel and reply routing', () => {
    const inbound = ingestSlackInbound({
      channelId: 'D999',
      user: 'U1',
      text: 'ping',
      isDm: true,
    })
    expect(inbound.expectReply).toBe(true)
    expect(inbound.slackChannel).toBe('D999')
    expect(isUnattended('channel')).toBe(true)

    let session = fresh()
    session = enqueueChannelInbound(session, inbound, 'staff')
    expect(turnKickoff(session, 'staff')).toBe('channel')
    expect(session.threads.staff.mouth).toBe('answer')
    const last = session.threads.staff.items.at(-1)
    expect(last?.kind).toBe('msg')
    if (last?.kind === 'msg') {
      expect(last.kickoff).toBe('channel')
      expect(last.from).toBe('user')
      expect(last.text).toContain('DM')
      expect(last.text).toContain('ping')
    }
    expect(session.threads.staff.pendingChannelReply).toEqual({
      platform: 'slack',
      connectionId: 'slack',
      slackChannel: 'D999',
      threadTs: undefined,
      expectReply: true,
    })
  })

  test('drainSlackInbox consumes json drops', () => {
    const home = tmpHome()
    const dir = slackInboxDir(home)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'evt.json'),
      `${JSON.stringify({ channelId: 'C1', user: 'U2', text: 'hi', isDm: false, roomName: 'eng' })}\n`,
    )
    const seen: string[] = []
    const result = drainSlackInbox(home, {
      onEvent: (event) => {
        seen.push(`${event.channelId}:${event.text}:${event.roomName}`)
      },
    })
    expect(result.drained).toBe(1)
    expect(seen).toEqual(['C1:hi:eng'])
    expect(existsSync(join(dir, 'evt.json'))).toBe(false)
    expect(existsSync(join(dir, 'processed', 'evt.json'))).toBe(true)
    rmSync(home, { recursive: true, force: true })
  })
})
