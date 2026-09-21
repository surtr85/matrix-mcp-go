package format

import (
	"bytes"
	"fmt"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	extast "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/renderer"
	"github.com/yuin/goldmark/renderer/html"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

var (
	dirAttrKey  = []byte("dir")
	dirRTLValue = []byte("rtl")
	dirLTRValue = []byte("ltr")
)

// bidiASTTransformer walks the Goldmark AST and sets directional attributes on blocks.
type bidiASTTransformer struct{}

func (b *bidiASTTransformer) Transform(node *ast.Document, reader text.Reader, pc parser.Context) {
	source := reader.Source()

	_ = ast.Walk(node, func(n ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}

		switch n.Kind() {
		case ast.KindParagraph, ast.KindHeading:
			// Extract plain text representation of this paragraph/heading
			nodeText := extractText(n, source)
			dir := DetectDirection(nodeText)
			if dir == DirRTL {
				n.SetAttribute(dirAttrKey, dirRTLValue)
			} else {
				n.SetAttribute(dirAttrKey, dirLTRValue)
			}

		case ast.KindFencedCodeBlock, ast.KindCodeBlock:
			// Code blocks must always be LTR to prevent syntax/indentation flipping in RTL viewports
			n.SetAttribute(dirAttrKey, dirLTRValue)

		case ast.KindCodeSpan:
			// Inline code spans must always be LTR
			n.SetAttribute(dirAttrKey, dirLTRValue)

		case extast.KindTable:
			// For tables, inspect the header or cells to determine overall table direction
			tableText := extractText(n, source)
			if DetectDirection(tableText) == DirRTL {
				n.SetAttribute(dirAttrKey, dirRTLValue)
			} else {
				n.SetAttribute(dirAttrKey, dirLTRValue)
			}
		}

		return ast.WalkContinue, nil
	})
}

// extractText extracts the visible textual content from an AST subtree.
func extractText(n ast.Node, source []byte) string {
	var buf strings.Builder

	_ = ast.Walk(n, func(child ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}

		// Skip code blocks and code spans when determining paragraph language direction
		if child.Kind() == ast.KindCodeSpan || child.Kind() == ast.KindFencedCodeBlock || child.Kind() == ast.KindCodeBlock {
			return ast.WalkSkipChildren, nil
		}

		if textNode, ok := child.(*ast.Text); ok {
			buf.Write(textNode.Segment.Value(source))
		} else if stringNode, ok := child.(*ast.String); ok {
			buf.Write(stringNode.Value)
		}

		return ast.WalkContinue, nil
	})

	return buf.String()
}

// matrixHTMLRenderer customizes Goldmark HTML rendering to comply with Matrix HTML specifications.
type matrixHTMLRenderer struct {
	html.Config
}

func newMatrixHTMLRenderer(opts ...html.Option) renderer.NodeRenderer {
	r := &matrixHTMLRenderer{
		Config: html.NewConfig(),
	}
	for _, opt := range opts {
		opt.SetHTMLOption(&r.Config)
	}
	return r
}

func (r *matrixHTMLRenderer) RegisterFuncs(reg renderer.NodeRendererFuncRegisterer) {
	// Register custom block and inline writers
	reg.Register(ast.KindParagraph, r.renderParagraph)
	reg.Register(ast.KindHeading, r.renderHeading)
	reg.Register(ast.KindCodeBlock, r.renderCodeBlock)
	reg.Register(ast.KindFencedCodeBlock, r.renderFencedCodeBlock)
	reg.Register(ast.KindCodeSpan, r.renderCodeSpan)
	reg.Register(extast.KindTable, r.renderTable)
}

func (r *matrixHTMLRenderer) renderParagraph(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if entering {
		dir := getDirectionAttr(node)
		if dir != "" {
			_, _ = fmt.Fprintf(w, "<p dir=\"%s\">", dir)
		} else {
			_, _ = w.WriteString("<p>")
		}
	} else {
		_, _ = w.WriteString("</p>\n")
	}
	return ast.WalkContinue, nil
}

func (r *matrixHTMLRenderer) renderHeading(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	n := node.(*ast.Heading)
	if entering {
		dir := getDirectionAttr(node)
		if dir != "" {
			_, _ = fmt.Fprintf(w, "<h%d dir=\"%s\">", n.Level, dir)
		} else {
			_, _ = fmt.Fprintf(w, "<h%d>", n.Level)
		}
	} else {
		_, _ = fmt.Fprintf(w, "</h%d>\n", n.Level)
	}
	return ast.WalkContinue, nil
}

func (r *matrixHTMLRenderer) renderCodeBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString("<pre dir=\"ltr\"><code>")
		r.renderLines(w, source, node)
	} else {
		_, _ = w.WriteString("</code></pre>\n")
	}
	return ast.WalkContinue, nil
}

func (r *matrixHTMLRenderer) renderFencedCodeBlock(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	n := node.(*ast.FencedCodeBlock)
	if entering {
		lang := string(n.Language(source))
		if lang != "" {
			// Sanitize language class for Matrix HTML
			langClass := util.EscapeHTML([]byte(lang))
			_, _ = fmt.Fprintf(w, "<pre dir=\"ltr\"><code class=\"language-%s\">", langClass)
		} else {
			_, _ = w.WriteString("<pre dir=\"ltr\"><code>")
		}
		r.renderLines(w, source, node)
	} else {
		_, _ = w.WriteString("</code></pre>\n")
	}
	return ast.WalkContinue, nil
}

func (r *matrixHTMLRenderer) renderCodeSpan(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if entering {
		_, _ = w.WriteString("<code dir=\"ltr\">")
		for c := node.FirstChild(); c != nil; c = c.NextSibling() {
			segment := c.(*ast.Text).Segment
			value := segment.Value(source)
			_, _ = w.Write(util.EscapeHTML(value))
		}
	} else {
		_, _ = w.WriteString("</code>")
	}
	return ast.WalkSkipChildren, nil
}

func (r *matrixHTMLRenderer) renderTable(w util.BufWriter, source []byte, node ast.Node, entering bool) (ast.WalkStatus, error) {
	if entering {
		dir := getDirectionAttr(node)
		if dir != "" {
			_, _ = fmt.Fprintf(w, "<table dir=\"%s\">\n", dir)
		} else {
			_, _ = w.WriteString("<table>\n")
		}
	} else {
		_, _ = w.WriteString("</table>\n")
	}
	return ast.WalkContinue, nil
}

func (r *matrixHTMLRenderer) renderLines(w util.BufWriter, source []byte, node ast.Node) {
	l := node.Lines().Len()
	for i := 0; i < l; i++ {
		line := node.Lines().At(i)
		_, _ = w.Write(util.EscapeHTML(line.Value(source)))
	}
}

func getDirectionAttr(node ast.Node) string {
	if val, ok := node.Attribute(dirAttrKey); ok {
		if b, ok := val.([]byte); ok {
			return string(b)
		}
		if s, ok := val.(string); ok {
			return s
		}
	}
	return ""
}

// Formatter parses Markdown and renders Matrix-compliant HTML with BiDi attributes.
type Formatter struct {
	md goldmark.Markdown
}

// New creates and configures a new Formatter with Goldmark extensions and BiDi transformers.
func New() *Formatter {
	md := goldmark.New(
		goldmark.WithExtensions(
			extension.Table,
			extension.Strikethrough,
			extension.Linkify,
		),
		goldmark.WithParserOptions(
			parser.WithASTTransformers(
				util.Prioritized(&bidiASTTransformer{}, 100),
			),
		),
		goldmark.WithRendererOptions(
			renderer.WithNodeRenderers(
				util.Prioritized(newMatrixHTMLRenderer(), 100),
			),
			html.WithUnsafe(), // Safe filtering performed explicitly for allowed tags
		),
	)

	return &Formatter{md: md}
}

// defaultFormatter is a singleton instance for global package calls.
var defaultFormatter = New()

// FormatMessage transforms raw Markdown into clean plainText and Matrix-compliant formattedHTML.
func FormatMessage(rawMarkdown string) (plainText string, formattedHTML string, err error) {
	return defaultFormatter.Format(rawMarkdown)
}

// Format transforms raw Markdown into clean plainText and Matrix-compliant formattedHTML.
func (f *Formatter) Format(rawMarkdown string) (string, string, error) {
	trimmed := strings.TrimSpace(rawMarkdown)
	if trimmed == "" {
		return "", "", nil
	}

	src := []byte(trimmed)
	var buf bytes.Buffer
	if err := f.md.Convert(src, &buf); err != nil {
		return "", "", fmt.Errorf("failed to convert markdown: %w", err)
	}

	formattedHTML := strings.TrimSpace(buf.String())
	plainText := trimmed

	return plainText, formattedHTML, nil
}
