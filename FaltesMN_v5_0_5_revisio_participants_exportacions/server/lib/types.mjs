/**
 * @typedef {Object} Principal
 * @property {string} id
 * @property {string} name
 * @property {string} keyHash
 * @property {string} createdAt
 * @property {string=} revokedAt
 */

/**
 * @typedef {Object} Competition
 * @property {string} id
 * @property {string} code
 * @property {string} name
 * @property {'open'|'closed'} status
 * @property {string} createdAt
 * @property {string} createdByPrincipalId
 * @property {{principal?:string, referee:string, table:string}} joinTokens
 * @property {string=} closedAt
 */

/**
 * @typedef {Object} Actor
 * @property {string} id
 * @property {string} competitionId
 * @property {string} name
 * @property {'referee'|'table'|'principal'} role
 * @property {string} joinedAt
 */

/**
 * @typedef {Object} Event
 * @property {string} id
 * @property {string} competitionId
 * @property {string} actorId
 * @property {string} actorName
 * @property {'referee'|'table'|'principal'} actorRole
 * @property {number} bib
 * @property {string} faultCode
 * @property {string} faultText
 * @property {'B'|'G'|'V'|'A'} color
 * @property {'T'|'R'|'C'} category
 * @property {'fault'|'assist'|'withdraw'=} eventType
 * @property {number=} assistTargetBib
 * @property {number=} assistDurationSeconds
 * @property {string} capturedAt
 * @property {string} receivedAt
 */

/**
 * @typedef {Object} CheckState
 * @property {boolean} checked
 * @property {string} checkedAt
 * @property {string} checkedBy
 */

/**
 * @typedef {Object} PenaltyCompletion
 * @property {boolean} completed
 * @property {string} completedAt
 * @property {string} completedBy
 */

/**
 * @typedef {Object} AlertAckState
 * @property {boolean} acknowledged
 * @property {string} acknowledgedAt
 * @property {string} acknowledgedBy
 */

/**
 * @typedef {Object} RefStatus
 * @property {string} lastSeenAt
 * @property {number} pendingCount
 */


/**
 * @typedef {'M'|'F'|'-'|''} ParticipantGender
 */

/**
 * @typedef {'Infantil'|'Cadet'|'Junior'|'Promesa'|'Sènior'|'Veterà A'|'Veterà B'|'Veterà C'|'Veterà D'|''} ParticipantCategory
 */

/**
 * @typedef {Object} ParticipantEntry
 * @property {number} bib
 * @property {boolean=} noShow
 * @property {string} fullName
 * @property {ParticipantGender} gender
 * @property {ParticipantCategory} category
 * @property {string} grossTime
 * @property {string} penaltyTime
 * @property {string} bonusTime
 * @property {string=} updatedAt
 * @property {string=} updatedBy
 */

/**
 * @typedef {Object} PrincipalSession
 * @property {string} principalId
 * @property {string=} createdAt
 * @property {string=} updatedAt
 */

/**
 * @typedef {Object} ActorSession
 * @property {string} actorId
 * @property {string} competitionId
 * @property {'referee'|'table'|'principal'} role
 * @property {string=} createdAt
 * @property {string=} updatedAt
 */

/**
 * @typedef {Object} DataFile
 * @property {number} schemaVersion
 * @property {Record<string, Principal>} principals
 * @property {Record<string, Competition>} competitions
 * @property {Record<string, Actor>} actors
 * @property {Record<string, Event[]>} events
 * @property {Record<string, CheckState>} checks
 * @property {Record<string, PenaltyCompletion>} penaltyCompletions
 * @property {Record<string, AlertAckState>} alertAcks
 * @property {Record<string, Record<string, RefStatus>>} status
 * @property {Record<string, Record<string, ParticipantEntry>>} participants
 * @property {Record<string, PrincipalSession>} principalSessions
 * @property {Record<string, ActorSession>} actorSessions
 */

export {};
