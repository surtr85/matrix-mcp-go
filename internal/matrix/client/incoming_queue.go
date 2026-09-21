package client

import (
	"sync"

	"github.com/amadeus/matrix-mcp-go/internal/mcp"
	"maunium.net/go/mautrix/id"
)

// incomingWaiter represents an active polling request waiting for an incoming message.
type incomingWaiter struct {
	roomID   id.RoomID
	threadID id.EventID
	ch       chan *mcp.IncomingMessage
}

// IncomingQueue manages active listeners and event deduplication for WaitForIncomingMessage.
type IncomingQueue struct {
	mu           sync.RWMutex
	waiters      map[*incomingWaiter]struct{}
	seenEventIDs map[id.EventID]struct{}
	eventOrder   []id.EventID
	maxSeen      int
}

// NewIncomingQueue creates an initialized IncomingQueue with an LRU/ring capacity for seen event IDs.
func NewIncomingQueue(maxSeen int) *IncomingQueue {
	if maxSeen <= 0 {
		maxSeen = 10000
	}
	return &IncomingQueue{
		waiters:      make(map[*incomingWaiter]struct{}),
		seenEventIDs: make(map[id.EventID]struct{}),
		eventOrder:   make([]id.EventID, 0, maxSeen),
		maxSeen:      maxSeen,
	}
}

// Register registers a waiter for a given roomID and threadID (either can be empty to match any).
// Returns a channel and a cancel/cleanup function.
func (q *IncomingQueue) Register(roomID id.RoomID, threadID id.EventID) (<-chan *mcp.IncomingMessage, func()) {
	q.mu.Lock()
	defer q.mu.Unlock()

	ch := make(chan *mcp.IncomingMessage, 1)
	waiter := &incomingWaiter{
		roomID:   roomID,
		threadID: threadID,
		ch:       ch,
	}
	q.waiters[waiter] = struct{}{}

	cleanup := func() {
		q.mu.Lock()
		defer q.mu.Unlock()
		delete(q.waiters, waiter)
	}

	return ch, cleanup
}

// Dispatch attempts to deliver an incoming event to the first matching waiter.
// It performs deduplication on eventID to ensure an event is never processed twice.
// Returns true if a waiter matched and received the message.
func (q *IncomingQueue) Dispatch(msg *mcp.IncomingMessage) bool {
	q.mu.Lock()
	defer q.mu.Unlock()

	evID := id.EventID(msg.EventID)
	if _, seen := q.seenEventIDs[evID]; seen {
		return false
	}

	// Mark as seen
	q.seenEventIDs[evID] = struct{}{}
	q.eventOrder = append(q.eventOrder, evID)
	if len(q.eventOrder) > q.maxSeen {
		oldest := q.eventOrder[0]
		q.eventOrder = q.eventOrder[1:]
		delete(q.seenEventIDs, oldest)
	}

	// Find the first matching waiter
	for waiter := range q.waiters {
		// Room filter check
		if waiter.roomID != "" && waiter.roomID != id.RoomID(msg.RoomID) {
			continue
		}

		// Thread filter check
		if waiter.threadID != "" && waiter.threadID != id.EventID(msg.ThreadID) {
			continue
		}

		// Matched! Send to channel and remove waiter so single message is consumed once
		select {
		case waiter.ch <- msg:
			delete(q.waiters, waiter)
			return true
		default:
			delete(q.waiters, waiter)
		}
	}

	return false
}
