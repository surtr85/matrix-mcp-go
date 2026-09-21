package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// MessagesSentTotal tracks total messages sent to Matrix rooms.
	MessagesSentTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "matrix_messages_sent_total",
			Help: "Total number of messages sent to Matrix rooms",
		},
		[]string{"room_id", "status"},
	)

	// SyncEventsTotal tracks total events processed from Matrix sync.
	SyncEventsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "matrix_sync_events_total",
			Help: "Total number of Matrix sync events processed",
		},
		[]string{"type"},
	)

	// ToolCallsTotal tracks MCP tool invocations.
	ToolCallsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "matrix_mcp_tool_calls_total",
			Help: "Total number of MCP tool calls executed",
		},
		[]string{"tool", "status"},
	)

	// ToolDurationSeconds records execution latency for MCP tools.
	ToolDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "matrix_mcp_tool_duration_seconds",
			Help:    "Histogram of MCP tool execution durations in seconds",
			Buckets: []float64{0.01, 0.05, 0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0},
		},
		[]string{"tool"},
	)
)

// RecordToolCall measures latency and outcome for an MCP tool call.
func RecordToolCall(tool string, isError bool, durationSeconds float64) {
	status := "success"
	if isError {
		status = "error"
	}
	ToolCallsTotal.WithLabelValues(tool, status).Inc()
	ToolDurationSeconds.WithLabelValues(tool).Observe(durationSeconds)
}

// RecordMessageSent records a sent message.
func RecordMessageSent(roomID string, success bool) {
	status := "success"
	if !success {
		status = "error"
	}
	MessagesSentTotal.WithLabelValues(roomID, status).Inc()
}

// RecordSyncEvent records an event processed during sync.
func RecordSyncEvent(eventType string) {
	SyncEventsTotal.WithLabelValues(eventType).Inc()
}
