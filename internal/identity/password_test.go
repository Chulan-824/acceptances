package identity

import "testing"

func TestPasswordHashes(t *testing.T) {
	hash, err := HashPassword("isolated-test-password")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("isolated-test-password", hash) || VerifyPassword("wrong-password", hash) {
		t.Fatal("password verification failed")
	}
	second, err := HashPassword("isolated-test-password")
	if err != nil {
		t.Fatal(err)
	}
	if hash == second {
		t.Fatal("password salts must be independent")
	}
	if VerifyPassword("anything", "$argon2id$v=19$m=999999999,t=2,p=1$x$x") {
		t.Fatal("unbounded parameters must be rejected")
	}
}
