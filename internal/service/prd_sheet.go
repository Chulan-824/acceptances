package service

import (
	"math/big"

	"github.com/Chulan-824/acceptances/internal/prd"
)

func staleSheetRevision(head, next prd.Manifest) bool {
	for _, candidate := range next.Resources {
		if candidate.Kind != "sheet" || candidate.Status != "saved" {
			continue
		}
		for _, previous := range head.Resources {
			if previous.Kind != "sheet" || previous.Status != "saved" || previous.ResourceID != candidate.ResourceID || previous.SheetID != candidate.SheetID {
				continue
			}
			before, beforeOK := new(big.Int).SetString(previous.RevisionID, 10)
			after, afterOK := new(big.Int).SetString(candidate.RevisionID, 10)
			if !beforeOK || !afterOK || after.Cmp(before) < 0 {
				return true
			}
		}
	}
	return false
}
