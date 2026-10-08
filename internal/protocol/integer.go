package protocol

import (
	"encoding/json"
	"math"
)

// JSONInteger accepts every JSON Schema integer spelling within the protocol range.
// Raw document bytes remain unchanged; this is only a typed projection.
type JSONInteger int64

func (i *JSONInteger) UnmarshalJSON(raw []byte) error {
	value, err := Decode(raw)
	if err != nil {
		return err
	}
	n, ok := value.(json.Number)
	if !ok {
		return Failure("SCHEMA_INVALID", "", "JSON integer required")
	}
	f, err := n.Float64()
	if err != nil || math.Trunc(f) != f || math.Abs(f) > 9007199254740991 {
		return Failure("SCHEMA_INVALID", "", "integer outside protocol range")
	}
	*i = JSONInteger(int64(f))
	return nil
}
