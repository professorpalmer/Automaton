import { describe, expect, test } from 'bun:test'
import {
  bindHomes,
  composerEnterBusy,
  createAgentNames,
  DEFAULT_AGENTS,
  dispatchTargets,
  emptyThreads,
  homeAck,
  isMouthBusy,
  isPing,
  dispatchWork,
  jobKindFor,
  jobKindForKit,
  lastSpoken,
    looksLikeJob,
    looksLikeBoxShell,
    looksLikeCodebaseAsk,
    looksLikeFileAsk,
    looksLikeJobStatusAsk,
    looksLikeSourceAsk,
    keepAliveStatus,
    isWhitelistedRunningStatus,
    runningStatusNote,
    STILL_RUNNING,
  nextMandateJob,
  firstAskStep,
  remainingAsk,
  splitAskSteps,
  parseLocalHomes,
  parseBoxShellIntent,
  jobKindLabel,
  mentionedAgentIds,
  needsFanoutConfirm,
  parseDeskUrl,
  deskOpenAck,
  deskHandoffInstruction,
  parseGithubHomes,
  sanitizeDeskUrl,
  renameAgents,
  resetIdsForTests,
  assessAsk,
  returnBeat,
  staffWithSisters,
  visibleAgents,
  feedClock,
  shouldShowFeedClock,
  sameFeedVoice,
  feedThinking,
  thinkingDots,
  type FeedItem,
} from '../src/domain'

describe('mouth vs job', () => {
  test('working is not mouth-busy and does not steal Enter', () => {
    expect(isMouthBusy('working')).toBe(false)
    expect(composerEnterBusy('working')).toBe(false)
    expect(composerEnterBusy('idle')).toBe(false)
    expect(composerEnterBusy('must_first')).toBe(true)
  })

  test('feed thinking is mouth wait after a turn, not a job', () => {
    const user: FeedItem[] = [{ kind: 'msg', id: 'u1', from: 'user', agentId: 'staff', text: 'Hello.' }]
    expect(feedThinking('answer', user)).toBe(true)
    expect(feedThinking('must_first', user)).toBe(true)
    expect(feedThinking('working', user)).toBe(false)
    expect(feedThinking('idle', user)).toBe(false)
    expect(feedThinking('answer', [])).toBe(false)
    expect(thinkingDots(0)).toBe('.')
    expect(thinkingDots(3)).toBe('....')
    expect(thinkingDots(4)).toBe('.')
  })

  test('hidden agents stay out of the rail', () => {
    const agents = staffWithSisters().map((agent) =>
      agent.id === 'research' ? { ...agent, hidden: true } : agent,
    )
    expect(visibleAgents(agents).map((a) => a.id)).toEqual(['staff', 'kernel'])
  })

  test('fan-out confirm is 3+ mentions', () => {
    expect(needsFanoutConfirm(['staff'])).toBe(false)
    expect(needsFanoutConfirm(['staff', 'kernel', 'research'])).toBe(true)
    expect(mentionedAgentIds('Kernel, the insert breaks undo.', staffWithSisters())).toEqual([])
    expect(mentionedAgentIds('@Kernel @Research @Staff look', staffWithSisters())).toEqual([
      'kernel',
      'research',
      'staff',
    ])
    expect(mentionedAgentIds('@Chief look', DEFAULT_AGENTS)).toEqual(['staff'])
  })

  test('job heuristic is not every short chat', () => {
    expect(looksLikeJob('hey')).toBe(false)
    expect(looksLikeJob('Kernel, the mention insert breaks undo on the composer.')).toBe(true)
    expect(jobKindFor('staff', 'Hello, what is your name?')).toBeNull()
    expect(jobKindFor('staff', 'Kernel, the mention insert breaks undo on the composer.')).toBe(
      'implement',
    )
    expect(jobKindFor('kernel', 'Kernel, the mention insert breaks undo on the composer.')).toBe(
      'implement',
    )
    expect(jobKindFor('research', 'Look up why Send stays Send in Automaton staff.')).toBe(
      'analyze',
    )
    expect(jobKindFor('kernel', 'Look up why Send stays Send in Automaton staff.')).toBe('analyze')
  })

  test('kit policy: coordinator books like code; blank never jobs; lookup never implements', () => {
    const job = 'Kernel, the mention insert breaks undo on the composer.'
    const lookup = 'Look up why Send stays Send in Automaton staff.'
    expect(jobKindForKit('coordinator', job)).toBe('implement')
    expect(jobKindForKit('coordinator', 'Hello, what is your name on this seat?')).toBeNull()
    expect(jobKindForKit('coordinator', lookup)).toBe('analyze')
    expect(jobKindForKit('blank', job)).toBeNull()
    expect(jobKindForKit('lookup', job)).toBe('analyze')
    expect(jobKindForKit('lookup', lookup)).toBe('analyze')
    expect(jobKindForKit('code', job)).toBe('implement')
    expect(jobKindForKit('code', lookup)).toBe('analyze')
    expect(jobKindForKit('code', 'Can you ping Kernel, do we have any PRs or open issues?')).toBe(
      'analyze',
    )
    expect(jobKindForKit('code', 'check the ledger replay in Automaton staff.')).toBe('analyze')
    expect(jobKindForKit('coordinator', 'check the ledger replay in Automaton staff.')).toBeNull()
    expect(jobKindForKit('coordinator', 'is claude on PATH')).toBe('box-shell')
    expect(
      jobKindForKit(
        'coordinator',
        'what script does puppetmaster have its model routing logic contained in?',
      ),
    ).toBe('analyze')
    expect(
      jobKindForKit('coordinator', 'what about Marionette, what is the on-boarding like?'),
    ).toBe('analyze')
    expect(jobKindForKit('coordinator', 'can you show me some excerpts')).toBeNull()
    expect(
      jobKindForKit(
        'coordinator',
        'can you show me some excerpts',
        'what script does puppetmaster have its model routing logic contained in?',
      ),
    ).toBe('analyze')
    expect(looksLikeCodebaseAsk('Hello, what is your name on this seat?')).toBe(false)
    expect(looksLikeCodebaseAsk("What is Dugout's stack made up of?")).toBe(true)
    expect(looksLikeCodebaseAsk('Look at the repo and find the router logic')).toBe(false)
    expect(looksLikeCodebaseAsk('Look at the repo and find the router logic', [], true)).toBe(true)
    expect(jobKindForKit('coordinator', "What is Dugout's stack made up of?")).toBe('analyze')
    expect(jobKindForKit('coordinator', 'Look at the repo and find the router logic')).toBeNull()
    expect(jobKindForKit('code', 'Look at the repo and find the router logic')).toBe('analyze')
    expect(looksLikeSourceAsk('can you show me some excerpts')).toBe(true)
    expect(jobKindForKit('code', 'install curl on the computer')).toBe('box-shell')
    expect(jobKindForKit('blank', 'is claude on PATH')).toBeNull()
    expect(looksLikeBoxShell('is claude on PATH')).toBe(true)
    expect(looksLikeBoxShell('install curl on the computer')).toBe(true)
    expect(looksLikeBoxShell('implement the mention insert on the composer')).toBe(false)
    expect(parseBoxShellIntent('is claude on PATH')).toEqual({ kind: 'which', name: 'claude' })
    expect(parseBoxShellIntent('install curl on the computer')).toEqual({ kind: 'install', name: 'curl' })
    expect(parseBoxShellIntent('rm -rf /')).toBeNull()
    expect(jobKindLabel('box-shell')).toBe('shell')
  })

  test('leftover then/and steps book the next job kind', () => {
    const installThenPath = 'install curl on the computer then check if python is on PATH'
    expect(splitAskSteps(installThenPath)).toEqual([
      'install curl on the computer',
      'check if python is on PATH',
    ])
    expect(splitAskSteps('Look at the repo and find the router logic')).toEqual([
      'Look at the repo and find the router logic',
    ])
    expect(splitAskSteps('install curl on the computer and check if python is on PATH')).toHaveLength(
      2,
    )
    expect(firstAskStep(installThenPath)).toBe('install curl on the computer')
    expect(remainingAsk(installThenPath, 'install curl on the computer')).toBe(
      'check if python is on PATH',
    )
    expect(remainingAsk(installThenPath, 'check if python is on PATH')).toBe('')
    expect(
      nextMandateJob('coordinator', installThenPath, {
        kind: 'box-shell',
        goal: 'install curl on the computer',
      }),
    ).toEqual({ kind: 'box-shell', text: 'check if python is on PATH' })
    expect(
      nextMandateJob(
        'code',
        'look at marionette then implement the router patch in that checkout',
        { kind: 'analyze', goal: 'look at marionette' },
      ),
    ).toEqual({ kind: 'implement', text: 'implement the router patch in that checkout' })
    expect(
      nextMandateJob('code', 'install curl on the computer', {
        kind: 'box-shell',
        goal: 'install curl on the computer',
      }),
    ).toBeNull()
  })

  test('status asks are not new jobs; keepalive copy stays whitelisted', () => {
    expect(looksLikeJobStatusAsk('how did it go?')).toBe(true)
    expect(looksLikeJobStatusAsk("how's it going")).toBe(true)
    expect(looksLikeJobStatusAsk('what did you find')).toBe(true)
    expect(looksLikeJobStatusAsk('Look up why Send stays Send in Automaton staff.')).toBe(false)
    expect(looksLikeJobStatusAsk('Kernel, the ledger replay breaks on the composer path.')).toBe(false)
    expect(isWhitelistedRunningStatus(STILL_RUNNING)).toBe(true)
    expect(isWhitelistedRunningStatus('Still installing curl.')).toBe(true)
    expect(isWhitelistedRunningStatus('Done.')).toBe(false)
    expect(keepAliveStatus({ kind: 'analyze', goal: 'look up the ledger' })).toBe(STILL_RUNNING)
    expect(keepAliveStatus({ kind: 'box-shell', goal: 'install curl on the computer' })).toBe(
      'Still installing curl.',
    )
    expect(
      runningStatusNote({ kind: 'analyze', goal: 'look up the ledger', lastNote: 'Done.' }),
    ).toBe(STILL_RUNNING)
  })

  test('threads are per agent', () => {
    resetIdsForTests()
    expect(DEFAULT_AGENTS.map((agent) => agent.id)).toEqual(['staff'])
    const threads = emptyThreads(DEFAULT_AGENTS)
    expect(Object.keys(threads).sort()).toEqual(['staff'])
    expect(threads.staff.mouth).toBe('idle')
    expect(Object.keys(emptyThreads(staffWithSisters())).sort()).toEqual(['kernel', 'research', 'staff'])
  })

  test('head-seat dispatch is ask/tell/have/ping/see-if/check Name or @mention, not a vocative name', () => {
    const roster = staffWithSisters()
    const puppetmaster = {
      id: 'agent_pm',
      name: 'Puppetmaster',
      title: 'Code',
      description: '',
      color: '#777777',
      hidden: false,
    }
    const withPm = [...roster, puppetmaster]
    expect(dispatchTargets('Can you ask research if he is online?', roster, 'staff')).toEqual([
      'research',
    ])
    expect(isPing('Can you ask research if he is online?')).toBe(true)
    expect(isPing('Can you ping pupetmaster?')).toBe(true)
    expect(isPing('Can you ping Puppetmaster, do we have any PRs or open issues?')).toBe(false)
    expect(isPing('Can you see if Puppetmaster has any open issues or PRs for us?')).toBe(false)
    expect(isPing('hey ping Puppetmaster and check for open PRs', withPm)).toBe(false)
    expect(dispatchTargets('hey ping Puppetmaster and check for open PRs', withPm, 'staff')).toEqual([
      'agent_pm',
    ])
    expect(isPing('ping Puppetmaster', withPm)).toBe(true)
    expect(isPing('is Puppetmaster online', withPm)).toBe(true)
    expect(dispatchWork('hey ping Puppetmaster and check for open PRs', withPm)).toEqual({
      ping: false,
      note: 'Check for open PRs',
    })
    expect(dispatchWork('ping Puppetmaster', withPm).note).toBe('The operator asked if you are around.')
    expect(
      dispatchWork('Ask Kernel to install curl on the computer then check if python is on PATH', roster)
        .note,
    ).toMatch(/then .*python/i)
    expect(dispatchTargets('@Kernel @Research look this up', roster, 'staff')).toEqual([
      'kernel',
      'research',
    ])
    expect(isPing('@Kernel @Research look this up')).toBe(false)
    expect(needsFanoutConfirm(['kernel', 'research'])).toBe(false)
    expect(dispatchTargets('what is your name?', roster, 'staff')).toEqual([])
    expect(dispatchTargets('Have Research look up why Send stays Send.', roster, 'staff')).toEqual(
      ['research'],
    )
    expect(dispatchTargets('Kernel, the ledger replay breaks on the composer path.', roster, 'staff')).toEqual(
      [],
    )
    expect(
      dispatchTargets('Can you see if Puppetmaster has any open issues or PRs for us?', withPm, 'staff'),
    ).toEqual(['agent_pm'])
    expect(dispatchTargets('Can you ping pupetmaster?', withPm, 'staff')).toEqual(['agent_pm'])
    expect(
      dispatchTargets(
        'Check Marionette and Puppetmaster each for open PRs or issues, please.',
        [
          ...withPm,
          { id: 'agent_mn', name: 'Marionette', title: '', description: '', color: '#777777', hidden: false },
        ],
        'staff',
      ),
    ).toEqual(['agent_mn', 'agent_pm'])
    expect(
      dispatchTargets('Have Research look up why Kernel Send stays Send.', roster, 'staff'),
    ).toEqual(['research'])
  })

  test('create-automaton lines yield factory names', () => {
    expect(
      createAgentNames('Create an automaton for Marionette and one for Puppetmaster'),
    ).toEqual(['Marionette', 'Puppetmaster'])
    expect(createAgentNames('spin up a bot for Wiki')).toEqual(['Wiki'])
    expect(createAgentNames('hello staff')).toEqual([])
    expect(
      createAgentNames('post the new bot at https://github.com/example/Puppetmaster'),
    ).toEqual(['Puppetmaster'])
    expect(createAgentNames('post the new bot at the Puppetmaster repo')).toEqual(['Puppetmaster'])
    expect(
      createAgentNames(
        'create a new bot, find the local dugout repo, attach it to the bot, and name the bot Dugout.',
      ),
    ).toEqual(['Dugout'])
    expect(createAgentNames('make a new automaton and name it Scout')).toEqual(['Scout'])
  })

  test('local repo mentions bind a machine checkout home onto the named bot', () => {
    const roster = [
      ...DEFAULT_AGENTS,
      { id: 'agent_d', name: 'Dugout', title: '', description: '', color: '#777777', hidden: false },
    ]
    const text =
      'create a new bot, find the local dugout repo, attach it to the bot, and name the bot Dugout.'
    expect(parseLocalHomes(text)).toEqual([{ slug: 'dugout', url: '' }])
    expect(bindHomes(text, roster)).toEqual([{ agentId: 'agent_d', slug: 'dugout', url: '' }])
    expect(parseLocalHomes('check Marionette for open PRs')).toEqual([])
  })

  test('a concrete file plus a reveal verb is an analyze look, not a bare mouth turn', () => {
    expect(looksLikeFileAsk('Surface its agents.md and relay it to me')).toBe(true)
    expect(looksLikeFileAsk('show me src/domain.ts')).toBe(true)
    expect(looksLikeFileAsk('agents.md changed recently')).toBe(false)
    expect(looksLikeFileAsk('surface the onboarding flow')).toBe(false)
    expect(jobKindForKit('code', 'Surface its agents.md and relay it to me')).toBe('analyze')
    expect(jobKindForKit('lookup', 'read docs/staff.md and summarize')).toBe('analyze')
  })

  test('rename lines pair a roster mouth to a new name', () => {
    const roster = [
      ...DEFAULT_AGENTS,
      { id: 'agent_9', name: 'New Bot', title: '', description: '', color: '#777777', hidden: false },
    ]
    expect(renameAgents('rename New Bot to Puppetmaster', roster)).toEqual([
      { agentId: 'agent_9', name: 'Puppetmaster' },
    ])
    expect(renameAgents("Rename the 'New Bot' to Puppetmaster please.", roster)).toEqual([
      { agentId: 'agent_9', name: 'Puppetmaster' },
    ])
    expect(renameAgents('hello staff', roster)).toEqual([])
  })

  test('return beat assesses and never copies the sister line', () => {
    expect(returnBeat('Research', 'Yes, I am here.')).toBe('Research is on the rail.')
    expect(returnBeat('Research', 'Send stays Send while a job flies.')).toBe('Research finished.')
    expect(returnBeat('Research', 'Yes, I am here.')).not.toBe('Yes, I am here.')
    const ask = assessAsk('Research', "I'm here to assist you. How can I help?")
    expect(ask).toContain('Research answered:')
    expect(ask).toContain("I'm here to assist you. How can I help?")
    expect(ask).toContain('Do not repeat Research')
    expect(ask).toContain('re-ask')
    expect(ask).not.toContain('one next step')
  })

  test('github homes pair to roster names by repo slug', () => {
    const roster = [
      ...DEFAULT_AGENTS,
      {
        id: 'agent_p',
        name: 'Puppetmaster',
        title: '',
        description: '',
        color: '#777777',
        hidden: false,
      },
      {
        id: 'agent_m',
        name: 'Marionette',
        title: '',
        description: '',
        color: '#777777',
        hidden: false,
      },
    ]
    const text =
      'Associate Puppetmaster and Marionette with https://github.com/example/Puppetmaster and https://github.com/example/marionette/'
    expect(parseGithubHomes(text).map((row) => row.slug)).toEqual([
      'example/Puppetmaster',
      'example/marionette',
    ])
    expect(bindHomes(text, roster)).toEqual([
      {
        agentId: 'agent_p',
        slug: 'example/Puppetmaster',
        url: 'https://github.com/example/Puppetmaster',
      },
      {
        agentId: 'agent_m',
        slug: 'example/marionette',
        url: 'https://github.com/example/marionette',
      },
    ])
    expect(homeAck(roster, bindHomes(text, roster))).toBe(
      "Bound. Puppetmaster's home is example/Puppetmaster. Marionette's is example/marionette.",
    )
  })

  test('rail preview is the last agent line', () => {
    resetIdsForTests()
    const thread = emptyThreads(DEFAULT_AGENTS).staff
    thread.items = [
      { kind: 'msg', id: 'item_1', from: 'user', agentId: 'staff', text: 'hi' },
      { kind: 'msg', id: 'item_2', from: 'agent', agentId: 'staff', text: 'Send me a task whenever you are ready.' },
    ]
    expect(lastSpoken(thread, 'Coordinator')).toBe('Send me a task whenever you are ready.')
  })

  test('feed clock marks a new day or a long gap, not every line', () => {
    const now = Date.parse('2026-08-25T23:42:00')
    expect(feedClock(now, now)).toBe('Today 11:42 PM')
    const yesterday = Date.parse('2026-08-24T23:42:00')
    expect(feedClock(yesterday, now)).toBe('Yesterday 11:42 PM')
    const first: FeedItem = { kind: 'msg', id: 'a', from: 'user', agentId: 'staff', text: 'hi', at: now }
    const soon: FeedItem = { kind: 'msg', id: 'b', from: 'agent', agentId: 'staff', text: 'ok', at: now + 60_000 }
    const later: FeedItem = {
      kind: 'msg',
      id: 'c',
      from: 'user',
      agentId: 'staff',
      text: 'more',
      at: now + 16 * 60 * 1000,
    }
    expect(shouldShowFeedClock(null, first)).toBe(true)
    expect(shouldShowFeedClock(first, soon)).toBe(false)
    expect(shouldShowFeedClock(first, later)).toBe(true)
    expect(sameFeedVoice(first, soon, false)).toBe(false)
    expect(sameFeedVoice(first, { ...first, id: 'd', text: 'again' }, false)).toBe(true)
  })

  test('desk URL parse opens github login and leaves bind homes alone', () => {
    expect(
      parseDeskUrl('Can you navigate to the github on your pc so I can login?'),
    ).toBe('https://github.com/login')
    expect(parseDeskUrl('open https://example.com/login')).toBe('https://example.com/login')
    expect(sanitizeDeskUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeDeskUrl('https://github.com/login')).toBe('https://github.com/login')
    expect(
      parseDeskUrl('Create an automaton named Marionette associated with https://github.com/example/marionette'),
    ).toBeNull()
    expect(parseDeskUrl('hey ping Kernel and check for open PRs')).toBeNull()
    expect(parseDeskUrl('can you navigate to Google on your machine')).toBe('https://www.google.com/')
    expect(parseDeskUrl('open google.com')).toBe('https://google.com/')
    expect(parseDeskUrl('go to youtube.com')).toBe('https://youtube.com/')
    expect(parseDeskUrl('What about Puppetmaster?')).toBeNull()
    expect(deskOpenAck('https://github.com/login')).toBe('Opening github.com.')
    expect(deskHandoffInstruction('https://github.com/login')).toBe('Sign in to GitHub.')
    expect(deskHandoffInstruction('https://www.google.com/')).toBe('Sign in to your Google account.')
  })
})
