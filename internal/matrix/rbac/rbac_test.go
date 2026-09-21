package rbac_test

import (
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/matrix/rbac"
	"maunium.net/go/mautrix/id"
)

func TestAuthorizer_AllowAllWhenEmpty(t *testing.T) {
	auth := rbac.New(nil)
	if !auth.IsAllowed(id.UserID("@alice:example.com")) {
		t.Error("expected any user to be allowed when list is empty")
	}

	authWildcard := rbac.New([]string{"*"})
	if !authWildcard.IsAllowed(id.UserID("@bob:example.com")) {
		t.Error("expected any user to be allowed when wildcard '*' is provided")
	}
}

func TestAuthorizer_AllowlistedUsers(t *testing.T) {
	allowed := []string{"@alice:example.com", "@admin:example.com"}
	auth := rbac.New(allowed)

	if !auth.IsAllowed(id.UserID("@alice:example.com")) {
		t.Error("expected @alice:example.com to be allowed")
	}
	if !auth.IsAllowed(id.UserID("@admin:example.com")) {
		t.Error("expected @admin:example.com to be allowed")
	}
	if auth.IsAllowed(id.UserID("@stranger:example.com")) {
		t.Error("expected @stranger:example.com to be rejected")
	}
}
