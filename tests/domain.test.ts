import { describe, expect, test } from 'bun:test'
import {
  bindHomes,
  composerEnterBusy,
  shouldQueueSteer,
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
    looksLikeFinishLine,
    looksLikeInspect,
    looksLikeIssueWork,
    looksLikeJobStatusAsk,
    looksLikeLiveCheck,
    looksLikePromote,
    looksLikeRepoAsk,
    looksLikeShip,
    looksLikeValidate,
    criteriaFromAsk,
    looksLikeSourceAsk,
    keepAliveStatus,
    isWhitelistedRunningStatus,
    runningStatusNote,
    STILL_RUNNING,
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
  parseGithubIssue,
  issueWorkTargets,
  sanitizeDeskUrl,
  renameAgents,
  resetIdsForTests,
  assessAsk,
  asGoalBlockerSource,
  boundGoalEvidence,
  hydrateGoalBlocker,
  oldestWaitingUserGoal,
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
    expect(composerEnterBusy('must_first')).toBe(false)
    expect(composerEnterBusy('answer')).toBe(false)
    expect(composerEnterBusy('answer', true)).toBe(false)
    expect(isMouthBusy('intro')).toBe(true)
    expect(composerEnterBusy('intro')).toBe(false)
    expect(composerEnterBusy('ack')).toBe(false)
    expect(shouldQueueSteer('must_first')).toBe(true)
    expect(shouldQueueSteer('answer')).toBe(true)
    expect(shouldQueueSteer('working')).toBe(false)
    expect(shouldQueueSteer('idle')).toBe(false)
    expect(shouldQueueSteer('intro')).toBe(false)
    expect(shouldQueueSteer('idle', true)).toBe(true)
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
    expect(jobKindForKit('coordinator', 'check the ledger replay in Automaton staff.')).toBe('analyze')
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
    expect(jobKindLabel('promote')).toBe('land')
    expect(jobKindLabel('ship')).toBe('ship')
  })

  test('live world-state books analyze on coordinator; recall stays chat', () => {
    const check = 'check Puppetmaster and Marionette for prs or open issues'
    expect(looksLikeRepoAsk(check)).toBe(true)
    expect(looksLikeInspect(check)).toBe(true)
    expect(looksLikeLiveCheck(check)).toBe(true)
    expect(jobKindForKit('coordinator', check)).toBe('analyze')
    expect(jobKindForKit('code', check)).toBe('analyze')
    expect(looksLikeLiveCheck('do we have any PRs or open issues?')).toBe(true)
    expect(looksLikeLiveCheck('check the ledger replay in Automaton staff.')).toBe(true)
    expect(looksLikeLiveCheck('what is the current status of Puppetmaster?')).toBe(true)
    expect(looksLikeLiveCheck('what did Kernel find about ledger replay')).toBe(false)
    expect(looksLikeLiveCheck('remember the Kernel finding about ledger replay')).toBe(false)
    expect(jobKindForKit('coordinator', 'what did Kernel find about ledger replay')).toBeNull()
    expect(jobKindForKit('blank', 'do we have any PRs or open issues?')).toBe('analyze')
    expect(jobKindForKit('blank', 'Check for open PRs')).toBe('analyze')
    expect(jobKindForKit('blank', 'Kernel, the mention insert breaks undo on the composer.')).toBeNull()
    const assess = assessAsk('Marionette', 'There are 2 open PRs and 1 open issue.')
    expect(looksLikeLiveCheck(assess)).toBe(false)
    expect(assess).toContain('open PRs')
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
    expect(criteriaFromAsk(installThenPath, 'coordinator').map((row) => row.kind)).toEqual([
      'box-shell',
      'box-shell',
    ])
    expect(criteriaFromAsk(installThenPath, 'coordinator').map((row) => row.work)).toEqual([
      'install curl on the computer',
      'check if python is on PATH',
    ])
    expect(
      criteriaFromAsk('look at marionette then implement the router patch in that checkout', 'code').map(
        (row) => row.kind,
      ),
    ).toEqual(['analyze', 'implement'])
    expect(criteriaFromAsk('install curl on the computer', 'code')).toEqual([
      { label: 'shell', kind: 'box-shell', work: 'install curl on the computer' },
    ])
  })

  test('a numbered GitHub issue is absorb work, not a home ping', () => {
    const url = 'https://github.com/professorpalmer/marionette/issues/223'
    const ask = `${url} take it to the finish line, absorb it, merge it from dest to main so the branches are equal, and ship it when done, new release.`
    expect(parseGithubIssue(url)).toEqual({
      owner: 'professorpalmer',
      repo: 'marionette',
      number: 223,
      kind: 'issue',
      url,
    })
    expect(parseGithubIssue('https://github.com/professorpalmer/marionette')).toBeNull()
    expect(looksLikeIssueWork(ask)).toBe(true)
    expect(looksLikeFinishLine(ask)).toBe(true)
    expect(looksLikePromote(ask)).toBe(true)
    expect(looksLikeShip(ask)).toBe(true)
    expect(splitAskSteps(ask)).toEqual([
      `absorb ${url}`,
      'merge dest to main',
      'ship a new release',
    ])
    expect(criteriaFromAsk(ask, 'code').map((row) => row.kind)).toEqual([
      'implement',
      'promote',
      'ship',
    ])
    expect(jobKindForKit('code', firstAskStep(ask))).toBe('implement')
    expect(jobKindForKit('coordinator', firstAskStep(ask))).toBe('implement')
    expect(jobKindForKit('lookup', firstAskStep(ask))).toBe('analyze')
    expect(jobKindForKit('code', 'merge dest to main')).toBe('promote')
    expect(jobKindForKit('code', 'ship a new release')).toBe('ship')
    expect(isPing(ask, staffWithSisters())).toBe(false)
    const marionette = {
      id: 'agent_m',
      name: 'Marionette',
      title: '',
      description: '',
      color: '#777777',
      hidden: false,
    }
    expect(issueWorkTargets(ask, [...staffWithSisters(), marionette], 'staff')).toEqual(['agent_m'])
    expect(
      jobKindForKit('code', 'Can you ping Kernel, do we have any PRs or open issues?'),
    ).toBe('analyze')
  })

  test('a numbered pull with validated/absorbed/merged/new release compiles analyze first', () => {
    const url = 'https://github.com/professorpalmer/marionette/pull/12'
    const ask = `Here is a PR ${url} can we get it validated, absorbed, merged, new release?`
    expect(looksLikeValidate(ask)).toBe(true)
    expect(looksLikeFinishLine(ask)).toBe(true)
    expect(looksLikePromote(ask)).toBe(true)
    expect(looksLikeShip(ask)).toBe(true)
    expect(criteriaFromAsk(ask, 'code').map((row) => ({ kind: row.kind, label: row.label }))).toEqual([
      { kind: 'analyze', label: 'validate' },
      { kind: 'implement', label: 'absorb' },
      { kind: 'promote', label: 'merge' },
      { kind: 'ship', label: 'ship' },
    ])
    expect(jobKindForKit('code', firstAskStep(ask))).toBe('analyze')
    expect(
      criteriaFromAsk(`absorb ${url}`, 'code').map((row) => row.kind),
    ).toEqual(['implement'])
  })

  test('bare tag and incidental shipping are not a release', () => {
    expect(looksLikeShip('look at the tag in package.json')).toBe(false)
    expect(looksLikeShip('the feature is shipping next week')).toBe(false)
    expect(looksLikeShip('we shipped yesterday')).toBe(false)
    expect(looksLikeShip('the commit was tagged')).toBe(false)
    expect(looksLikeShip('new release')).toBe(true)
    expect(looksLikeShip('cut a release')).toBe(true)
    expect(looksLikeShip('tag a release')).toBe(true)
    expect(looksLikeShip('ship a new release')).toBe(true)
    expect(looksLikeShip('ship')).toBe(true)
    expect(jobKindForKit('code', 'look at the tag in package.json')).not.toBe('ship')
    expect(jobKindForKit('code', 'the feature is shipping next week')).not.toBe('ship')
    expect(criteriaFromAsk('look at the tag in package.json', 'code').some((row) => row.kind === 'ship')).toBe(
      false,
    )
    expect(criteriaFromAsk('the feature is shipping next week', 'code').some((row) => row.kind === 'ship')).toBe(
      false,
    )
  })

  test('a pull URL plus ship a new release inserts promote before ship', () => {
    const url = 'https://github.com/professorpalmer/marionette/pull/12'
    const ask = `${url} ship a new release`
    expect(looksLikeShip(ask)).toBe(true)
    expect(looksLikePromote(ask)).toBe(false)
    expect(splitAskSteps(ask)).toEqual([`absorb ${url}`, 'merge dest to main', 'ship a new release'])
    expect(criteriaFromAsk(ask, 'code').map((row) => row.kind)).toEqual(['implement', 'promote', 'ship'])
  })

  test('status asks are not new jobs; keepalive copy stays whitelisted', () => {
    expect(looksLikeJobStatusAsk('how did it go?')).toBe(true)
    expect(looksLikeJobStatusAsk("how's it going")).toBe(true)
    expect(looksLikeJobStatusAsk('what did you find')).toBe(true)
    expect(looksLikeJobStatusAsk('Look up why Send stays Send in Automaton staff.')).toBe(false)
    expect(looksLikeJobStatusAsk('Kernel, the ledger replay breaks on the composer path.')).toBe(false)
    expect(isWhitelistedRunningStatus(STILL_RUNNING)).toBe(true)
    expect(isWhitelistedRunningStatus('Waiting for required checks.')).toBe(true)
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

  test('oldest waiting_user goal keeps the Staff blocker and bounds evidence', () => {
    const first = {
      id: 'goal_old',
      text: 'land dest',
      coordinatorId: 'staff',
      ownerAgentId: 'staff',
      criteria: [{ id: 'crit_1', label: 'merge', kind: 'promote' as const, work: 'merge dest to main', status: 'blocked' as const }],
      receipts: [],
      status: 'waiting_user' as const,
      blocker: { reason: 'Need a product checkout to land dest.', criterionId: 'crit_1', jobId: 'job_1', at: 1 },
    }
    const later = { ...first, id: 'goal_new', blocker: { ...first.blocker, jobId: 'job_2', at: 2 } }
    expect(oldestWaitingUserGoal([first, later])?.id).toBe('goal_old')
    expect(oldestWaitingUserGoal([{ ...first, status: 'running', blocker: undefined }])).toBeUndefined()
    expect(boundGoalEvidence('Need a product checkout to land dest.')).toBe('Need a product checkout to land dest.')
    expect(boundGoalEvidence('HTTP 403 with OPENROUTER_KEY=sk-secret and ghp_abcdef1234')).not.toMatch(
      /sk-secret|ghp_abcdef|OPENROUTER_KEY=/,
    )
    expect(asGoalBlockerSource(undefined)).toBe('staff')
    expect(asGoalBlockerSource('host')).toBe('host')
    expect(hydrateGoalBlocker(first.blocker)?.source).toBe('staff')
  })
})
