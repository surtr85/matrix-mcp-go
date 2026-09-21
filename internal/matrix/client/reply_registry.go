package client

import (
	"sync"

	"github.com/amadeus/matrix-mcp-go/internal/mcp"
	"maunium.net/go/mautrix/id"
)

// replyWaiter represents a single pending question awaiting a human reply.
type replyWaiter struct {
	roomID   id.RoomID
	threadID id.EventID
	ch       chan *mcp.HumanReply
}

// ReplyRegistry manages active waiters for human-in-the-loop interactions.
type ReplyRegistry struct {
	mu      sync.RWMutex
	waiters map[string]*replyWaiter // key: roomID + ":" + threadID
}

// NewReplyRegistry creates an initialized ReplyRegistry.
func NewReplyRegistry() *ReplyRegistry {
	return &ReplyRegistry{
		waiters: make(map[string]*replyWaiter),
	}
}

func replyKey(roomID id.RoomID, threadID id.EventID) string {
	return string(roomID) + ":" + string(threadID)
}

// Register registers a waiter for a given room and thread ID (or question event ID).
// Returns a channel on which the reply will be sent, and a cleanup function.
func (r *ReplyRegistry) Register(roomID id.RoomID, threadID id.EventID) (<-chan *mcp.HumanReply, func()) {
	r.mu.Lock()
	defer r.mu.Unlock()

	key := replyKey(roomID, threadID)
	ch := make(chan *mcp.HumanReply, 1)
	waiter := &replyWaiter{
		roomID:   roomID,
		threadID: threadID,
		ch:       ch,
	}

	r.waiters[key] = waiter

	cleanup := func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if current, ok := r.waiters[key]; ok && current == waiter {
			delete(r.waiters, key)
		}
	}

	return ch, cleanup
}

// Dispatch tries to deliver an incoming message to a matching pending waiter.
// Returns true if a waiter matched and received the message.
func (r *ReplyRegistry) Dispatch(roomID id.RoomID, threadID id.EventID, reply *mcp.HumanReply) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// 1. Try exact match on roomID + threadID
	if threadID != "" {
		key := replyKey(roomID, threadID)
		if waiter, ok := r.waiters[key]; ok {
			select {
			case waiter.ch <- reply:
				return true
			default:
				return false
			}
		}
	}

	// 2. Fallback: if message is in room without threadID, or if thread root was target
	key := replyKey(roomID, "")
	if waiter, ok := r.waiters[key]; ok {
		select {
		case waiter.ch <- reply:
			return true
		default:
			return false
		}
	}

	return false
}
