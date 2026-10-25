"""Exact, model-independent action path checks shared by execution and regression."""


def validate_path(task, origin):
    if "path" not in task:
        return
    path = task["path"]
    if not isinstance(path, dict) or set(path) - {"required", "forbidden"}:
        raise ValueError("path 只支持 required 和 forbidden 动作数组")
    if not isinstance(path.get("required"), list) or not path["required"]:
        raise ValueError("path.required 必须为非空动作数组")
    for name in ("required", "forbidden"):
        rules = path.get(name, [])
        if not isinstance(rules, list):
            raise ValueError(f"path.{name} 必须为动作数组")
        for rule in rules:
            if (
                not isinstance(rule, dict)
                or set(rule) - {"kind", "label", "label_prefix", "url", "text"}
                or any(
                    not isinstance(value, str) or (not value and key != "text")
                    for key, value in rule.items()
                )
                or rule.get("kind") not in {"click", "fill", "select", "scroll", "wait"}
                or ("label" in rule) == ("label_prefix" in rule)
            ):
                raise ValueError(f"path.{name} 需要 kind 及 label 或 label_prefix，可选 url/text")
            if "url" in rule and origin(rule["url"]) != origin(task["url"]):
                raise ValueError("路径动作 URL 必须与入口同源")


def matches(action, rule):
    label = action.get("label", action.get("action", ""))
    return (
        all(
            action.get(key) == value
            for key, value in rule.items()
            if key not in {"label", "label_prefix"}
        )
        and ("label" not in rule or label == rule["label"])
        and ("label_prefix" not in rule or label.startswith(rule["label_prefix"]))
    )


def verify_path(actions, path):
    required = path.get("required", [])
    index, ordered, forbidden = 0, True, []
    for position, action in enumerate(actions):
        if action.get("outcome") not in {"executed", "dispatching"}:
            continue
        if any(matches(action, rule) for rule in path.get("forbidden", [])):
            forbidden.append(position)
        if action.get("outcome") != "executed":
            continue
        if any(matches(action, rule) for rule in required):
            if index < len(required) and matches(action, required[index]):
                index += 1
            else:
                ordered = False
    checks = {
        "required_complete": index == len(required),
        "ordered": ordered,
        "no_forbidden_actions": not forbidden,
    }
    return {"checks": checks, "passed": all(checks.values()), "forbidden_indices": forbidden}
