package model

import "context"

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

type userContextKey struct{}

func WithUser(ctx context.Context, user *User) context.Context {
	return context.WithValue(ctx, userContextKey{}, user)
}

func CurrentUser(ctx context.Context) *User {
	user, _ := ctx.Value(userContextKey{}).(*User)
	return user
}

func CurrentUserID(ctx context.Context) *string {
	if user := CurrentUser(ctx); user != nil {
		return new(user.ID)
	}
	return nil
}
