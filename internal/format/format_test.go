package format_test

import (
	"strings"
	"testing"

	"github.com/amadeus/matrix-mcp-go/internal/format"
)

func TestDetectDirection(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected format.Direction
	}{
		{"English simple", "Hello world", format.DirLTR},
		{"English with numbers and punctuation", "... 1234, What is this?", format.DirLTR},
		{"Persian simple", "سلام دنیا", format.DirRTL},
		{"Persian with leading symbols", "--- !!! سلام کاربر عزیز", format.DirRTL},
		{"Persian with English word", "سلام به همه در Golang", format.DirRTL},
		{"English with Persian word", "Hello to everyone in سلام", format.DirLTR},
		{"Empty text", "", format.DirLTR},
		{"Only numbers and symbols", "12345 !@#$%", format.DirLTR},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := format.DetectDirection(tt.input)
			if got != tt.expected {
				t.Errorf("DetectDirection(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestFormatMessage_English(t *testing.T) {
	input := "# Heading 1\n\nThis is a paragraph with **bold** and *italic* text."
	plain, formatted, err := format.FormatMessage(input)
	if err != nil {
		t.Fatalf("unexpected format error: %v", err)
	}

	if plain != input {
		t.Errorf("expected plain text %q, got %q", input, plain)
	}

	if !strings.Contains(formatted, "<h1 dir=\"ltr\">Heading 1</h1>") {
		t.Errorf("expected '<h1 dir=\"ltr\">Heading 1</h1>' in output, got: %s", formatted)
	}
	if !strings.Contains(formatted, "<p dir=\"ltr\">This is a paragraph with <strong>bold</strong> and <em>italic</em> text.</p>") {
		t.Errorf("expected paragraph with dir=ltr, got: %s", formatted)
	}
}

func TestFormatMessage_Persian(t *testing.T) {
	input := "# تیتر اول\n\nاین یک پیام فارسی تستی است که بسیار **مهم** می\u200cباشد."
	plain, formatted, err := format.FormatMessage(input)
	if err != nil {
		t.Fatalf("unexpected format error: %v", err)
	}

	if plain != input {
		t.Errorf("expected plain text %q, got %q", input, plain)
	}

	if !strings.Contains(formatted, "<h1 dir=\"rtl\">تیتر اول</h1>") {
		t.Errorf("expected '<h1 dir=\"rtl\">تیتر اول</h1>', got: %s", formatted)
	}
	if !strings.Contains(formatted, "<p dir=\"rtl\">این یک پیام فارسی تستی است که بسیار <strong>مهم</strong> می\u200cباشد.</p>") {
		t.Errorf("expected paragraph with dir=rtl, got: %s", formatted)
	}
}

func TestFormatMessage_BilingualAndCode(t *testing.T) {
	input := `
سلام! این یک دستور است: ` + "`git status`" + ` را اجرا کنید.

Here is a code snippet:

` + "```go\nfunc main() {\n    fmt.Println(\"سلام\")\n}\n```"

	_, formatted, err := format.FormatMessage(input)
	if err != nil {
		t.Fatalf("unexpected format error: %v", err)
	}

	// First paragraph starts with Persian "سلام" -> should be dir="rtl"
	if !strings.Contains(formatted, "<p dir=\"rtl\">") {
		t.Errorf("expected first paragraph dir=rtl, got: %s", formatted)
	}

	// Inline code span must be dir="ltr"
	if !strings.Contains(formatted, "<code dir=\"ltr\">git status</code>") {
		t.Errorf("expected inline code with dir=ltr, got: %s", formatted)
	}

	// Second paragraph starts with English -> should be dir="ltr"
	if !strings.Contains(formatted, "<p dir=\"ltr\">Here is a code snippet:</p>") {
		t.Errorf("expected second paragraph dir=ltr, got: %s", formatted)
	}

	// Fenced code block must be dir="ltr" with language-go class
	if !strings.Contains(formatted, "<pre dir=\"ltr\"><code class=\"language-go\">") {
		t.Errorf("expected pre/code block with dir=ltr and language-go, got: %s", formatted)
	}
}

func TestFormatMessage_ComplexNestedStructures(t *testing.T) {
	input := `
- Item 1
- Item 2
  - Subitem 2.1
  - Subitem 2.2

> This is a blockquote.

| Column 1 | Column 2 |
|----------|----------|
| Alpha    | Beta     |
`

	_, formatted, err := format.FormatMessage(input)
	if err != nil {
		t.Fatalf("unexpected format error: %v", err)
	}

	if !strings.Contains(formatted, "<ul>") || !strings.Contains(formatted, "<li>Item 1</li>") {
		t.Errorf("expected unordered list in output, got: %s", formatted)
	}
	if !strings.Contains(formatted, "<blockquote>") {
		t.Errorf("expected blockquote in output, got: %s", formatted)
	}
	if !strings.Contains(formatted, "<table dir=\"ltr\">") {
		t.Errorf("expected table with dir=ltr in output, got: %s", formatted)
	}
}

func BenchmarkFormatMessage(b *testing.B) {
	sample := "# گزارش عملکرد روزانه سیستم\n\n" +
		"این یک گزارش تستی شامل متن\u200cهای فارسی و **English keywords** مانند `kubernetes` و `matrix-mcp-go` است.\n\n" +
		"### کد نمونه:\n\n" +
		"```go\npackage main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"High performance Matrix MCP!\")\n}\n```\n\n" +
		"- مورد اول: بررسی همگام\u200cسازی (Sync Loop)\n" +
		"- مورد دوم: عملکرد فرمتر و BiDi\n" +
		"- مورد سوم: بررسی معیارهای امنیتی\n\n" +
		"| سرویس | وضعیت | تأخیر |\n" +
		"|-------|-------|-------|\n" +
		"| Matrix Gateway | فعال | 12ms |\n" +
		"| SQLite Engine | فعال | 1ms |\n"

	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _, err := format.FormatMessage(sample)
		if err != nil {
			b.Fatalf("benchmark failed: %v", err)
		}
	}
}
