package format

import (
	"unicode"
)

// Direction represents text direction (LTR or RTL).
type Direction string

const (
	DirLTR Direction = "ltr"
	DirRTL Direction = "rtl"
)

// IsRTLRune checks if a rune belongs to right-to-left scripts such as Arabic, Persian, or Hebrew.
func IsRTLRune(r rune) bool {
	// Arabic and Persian ranges:
	// 0x0600 - 0x06FF: Arabic
	// 0x0750 - 0x077F: Arabic Supplement
	// 0x08A0 - 0x08FF: Arabic Extended-A
	// 0xFB50 - 0xFDFF: Arabic Presentation Forms-A
	// 0xFE70 - 0xFEFF: Arabic Presentation Forms-B
	// 0x0590 - 0x05FF: Hebrew
	return (r >= 0x0600 && r <= 0x06FF) ||
		(r >= 0x0750 && r <= 0x077F) ||
		(r >= 0x08A0 && r <= 0x08FF) ||
		(r >= 0xFB50 && r <= 0xFDFF) ||
		(r >= 0xFE70 && r <= 0xFEFF) ||
		(r >= 0x0590 && r <= 0x05FF)
}

// DetectDirection scans the input text for the first strong directional character.
// It skips whitespace, digits, punctuation, and symbols.
// Returns DirRTL if the first strong character is RTL, otherwise DirLTR.
func DetectDirection(text string) Direction {
	for _, r := range text {
		// Ignore whitespace, digits, punctuation, and symbols as neutral characters
		if unicode.IsSpace(r) || unicode.IsDigit(r) || unicode.IsPunct(r) || unicode.IsSymbol(r) {
			continue
		}

		if IsRTLRune(r) {
			return DirRTL
		}

		// Any other letter is considered strong LTR (Latin, Cyrillic, Greek, CJK, etc.)
		if unicode.IsLetter(r) {
			return DirLTR
		}
	}

	return DirLTR
}
