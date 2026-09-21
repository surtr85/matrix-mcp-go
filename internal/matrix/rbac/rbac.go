package rbac

import (
	"strings"

	"maunium.net/go/mautrix/id"
)

// Authorizer checks whether a given Matrix user ID is authorized to interact with the bot.
type Authorizer struct {
	allowedAll   bool
	allowedUsers map[id.UserID]struct{}
}

// New creates a new Authorizer with a list of allowed user IDs or patterns.
// If allowedUsers is empty or contains "*", all users are permitted.
func New(allowedUsers []string) *Authorizer {
	auth := &Authorizer{
		allowedUsers: make(map[id.UserID]struct{}),
	}

	if len(allowedUsers) == 0 {
		// When no list is configured, default to allow all (or bot's own operations)
		auth.allowedAll = true
		return auth
	}

	for _, u := range allowedUsers {
		trimmed := strings.TrimSpace(u)
		if trimmed == "*" {
			auth.allowedAll = true
			return auth
		}
		if trimmed != "" {
			auth.allowedUsers[id.UserID(trimmed)] = struct{}{}
		}
	}

	return auth
}

// IsAllowed returns true if the user ID is authorized.
func (a *Authorizer) IsAllowed(userID id.UserID) bool {
	if a.allowedAll {
		return true
	}
	_, ok := a.allowedUsers[userID]
	return ok
}
