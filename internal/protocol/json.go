package protocol

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const SchemaVersion = "1.0.0"
const RulesetVersion = "1.0.0"
const EncodingVersion = "acceptances-jcs-1"
const DocumentLimit = 8 << 20
const ManifestLimit = 2 << 20
const ExtensionLimit = 64 << 10

func Digest(raw []byte) string { sum := sha256.Sum256(raw); return hex.EncodeToString(sum[:]) }

// Decode preserves number tokens and rejects lossy JSON input before Schema validation.
func Decode(raw []byte) (any, error) {
	if !utf8.Valid(raw) || bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) {
		return nil, Failure("INVALID_JSON", "", "JSON must be UTF-8 without BOM")
	}
	if err := checkSurrogates(raw); err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	value, err := readValue(dec, "", 0)
	if err != nil {
		return nil, err
	}
	if _, err = dec.Token(); err != io.EOF {
		return nil, Failure("INVALID_JSON", "", "expected exactly one JSON value")
	}
	return value, nil
}
func pointer(path, key string) string {
	return path + "/" + strings.ReplaceAll(strings.ReplaceAll(key, "~", "~0"), "/", "~1")
}
func readValue(dec *json.Decoder, path string, depth int) (any, error) {
	if depth > 128 {
		return nil, Failure("LIMIT_EXCEEDED", path, "JSON nesting exceeds 128")
	}
	t, err := dec.Token()
	if err != nil {
		return nil, Failure("INVALID_JSON", path, "invalid JSON token")
	}
	if delim, ok := t.(json.Delim); ok {
		switch delim {
		case '{':
			out := map[string]any{}
			for dec.More() {
				keyToken, e := dec.Token()
				if e != nil {
					return nil, Failure("INVALID_JSON", path, "invalid object key")
				}
				key, ok := keyToken.(string)
				if !ok {
					return nil, Failure("INVALID_JSON", path, "expected object key")
				}
				if _, exists := out[key]; exists {
					return nil, Failure("INVALID_JSON", pointer(path, key), "duplicate object key")
				}
				value, e := readValue(dec, pointer(path, key), depth+1)
				if e != nil {
					return nil, e
				}
				out[key] = value
			}
			if t, e := dec.Token(); e != nil || t != json.Delim('}') {
				return nil, Failure("INVALID_JSON", path, "unterminated object")
			}
			return out, nil
		case '[':
			out := []any{}
			for dec.More() {
				value, e := readValue(dec, pointer(path, strconv.Itoa(len(out))), depth+1)
				if e != nil {
					return nil, e
				}
				out = append(out, value)
			}
			if t, e := dec.Token(); e != nil || t != json.Delim(']') {
				return nil, Failure("INVALID_JSON", path, "unterminated array")
			}
			return out, nil
		default:
			return nil, Failure("INVALID_JSON", path, "unexpected delimiter")
		}
	}
	if n, ok := t.(json.Number); ok {
		f, e := strconv.ParseFloat(string(n), 64)
		if e != nil || math.IsInf(f, 0) || math.IsNaN(f) {
			return nil, Failure("INVALID_JSON", path, "number outside binary64 range")
		}
	}
	return t, nil
}
func checkSurrogates(raw []byte) error {
	inString := false
	for i := 0; i < len(raw); i++ {
		if raw[i] == '"' {
			inString = !inString
			continue
		}
		if !inString || raw[i] != '\\' {
			continue
		}
		i++
		if i >= len(raw) {
			break
		}
		if raw[i] != 'u' {
			continue
		}
		if i+4 >= len(raw) {
			return Failure("INVALID_JSON", "", "invalid Unicode escape")
		}
		n, e := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		if e != nil {
			return Failure("INVALID_JSON", "", "invalid Unicode escape")
		}
		i += 4
		if n >= 0xd800 && n <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return Failure("INVALID_JSON", "", "unpaired high surrogate")
			}
			low, e := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if e != nil || low < 0xdc00 || low > 0xdfff {
				return Failure("INVALID_JSON", "", "invalid surrogate pair")
			}
			i += 6
		} else if n >= 0xdc00 && n <= 0xdfff {
			return Failure("INVALID_JSON", "", "unpaired low surrogate")
		}
	}
	return nil
}

// Canonical implements RFC 8785: UTF-16 key order, ECMAScript numbers, no HTML escaping.
func Canonical(value any) ([]byte, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	parsed, err := Decode(raw)
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	err = canonicalValue(&out, parsed)
	return out.Bytes(), err
}
func canonicalValue(out *bytes.Buffer, value any) error {
	switch v := value.(type) {
	case nil:
		out.WriteString("null")
	case bool:
		out.WriteString(strconv.FormatBool(v))
	case string:
		writeString(out, v)
	case json.Number:
		f, e := strconv.ParseFloat(string(v), 64)
		if e != nil {
			return e
		}
		if f == 0 {
			out.WriteByte('0')
			break
		}
		format := byte('f')
		if math.Abs(f) < 1e-6 || math.Abs(f) >= 1e21 {
			format = 'e'
		}
		n := strconv.FormatFloat(f, format, -1, 64)
		if at := strings.IndexByte(n, 'e'); at >= 0 {
			exp, _ := strconv.Atoi(n[at+1:])
			sign := ""
			if exp >= 0 {
				sign = "+"
			}
			n = n[:at] + "e" + sign + strconv.Itoa(exp)
		}
		out.WriteString(n)
	case []any:
		out.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := canonicalValue(out, item); err != nil {
				return err
			}
		}
		out.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Slice(keys, func(i, j int) bool {
			a, b := utf16.Encode([]rune(keys[i])), utf16.Encode([]rune(keys[j]))
			for k := 0; k < len(a) && k < len(b); k++ {
				if a[k] != b[k] {
					return a[k] < b[k]
				}
			}
			return len(a) < len(b)
		})
		out.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				out.WriteByte(',')
			}
			writeString(out, key)
			out.WriteByte(':')
			if err := canonicalValue(out, v[key]); err != nil {
				return err
			}
		}
		out.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical value %T", value)
	}
	return nil
}
func writeString(out *bytes.Buffer, value string) {
	out.WriteByte('"')
	for _, r := range value {
		switch r {
		case '"':
			out.WriteString(`\"`)
		case '\\':
			out.WriteString(`\\`)
		case '\b':
			out.WriteString(`\b`)
		case '\t':
			out.WriteString(`\t`)
		case '\n':
			out.WriteString(`\n`)
		case '\f':
			out.WriteString(`\f`)
		case '\r':
			out.WriteString(`\r`)
		default:
			if r < 0x20 {
				fmt.Fprintf(out, `\u%04x`, r)
			} else {
				out.WriteRune(r)
			}
		}
	}
	out.WriteByte('"')
}
