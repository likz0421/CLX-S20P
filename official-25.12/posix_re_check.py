#!/usr/bin/env python3
"""POSIX-ERE validator for ucode regex literals.

Why this exists
---------------
ucode's match()/replace()/regexp() hand the pattern straight to glibc
regcomp(REG_EXTENDED). Two JS/PHP-flavoured habits therefore break at
*runtime*, with a stack trace that points into runtime.uc and tells you
nothing about the real file:

    Invalid character range            <- REG_ERANGE
    (runtime.uc:133 <- dispatcher.uc:960)

POSIX bracket-expression rules that bite:
  * a backslash inside [...] is an ORDINARY character, not an escape
  * `]` is literal only when it is the first character of the class
  * a `-` that is neither first nor last is a RANGE operator

So `[A-Za-z0-9\\-._]` is really class(A-Z a-z 0-9 '\\') + RANGE('\\','.')
= U+005C .. U+002E, which is REVERSED -> REG_ERANGE.

This module only reports REVERSED RANGES, because those are the ones that
actually make regcomp() fail. `A-Z` / `a-z` / `0-9` are intended ranges and
`\\s` / `\\n` inside a class merely over-permit, so neither is reported.

False-positive control: run with no arguments against a directory of stock
firmware ucode sources -- it must report 0 (see _verify/posix_re.py history:
the first version also flagged intended ranges and backslash-in-class, which
produced 155 noise hits across 59 stock files).

Usage:
    python3 posix_re_check.py <file-or-dir> [...]     # exit 1 on any problem
    import posix_re_check; posix_re_check.check_text(path, code)
"""
import os
import re
import sys

# a `/` after one of these starts a regex literal rather than being division
REGEX_START_PREV = set("(,=:[!&|?{;")

SPAN = re.compile(r"\{%(-?)(.*?)(-?)%\}|\{\{(.*?)\}\}", re.S)


def extract_regexes(code):
    """-> [(pattern, lineno)]; handles strings, comments, nested quotes."""
    out = []
    i, n = 0, len(code)
    line = 1
    prev_sig = ""
    while i < n:
        c = code[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = code.find("*/", i + 2)
            if j < 0:
                break
            line += code.count("\n", i, j + 2)
            i = j + 2
            continue
        if c == "/" and i + 1 < n and code[i + 1] == "/":
            j = code.find("\n", i)
            i = (j if j >= 0 else n)
            continue
        if c in "\"'`":
            q = c
            i += 1
            while i < n:
                if code[i] == "\\":
                    if code[i + 1:i + 2] == "\n":
                        line += 1
                    i += 2
                    continue
                if code[i] == q:
                    i += 1
                    break
                if code[i] == "\n":
                    line += 1
                i += 1
            prev_sig = '"'
            continue
        if c == "/" and (prev_sig == "" or prev_sig in REGEX_START_PREV):
            start_line = line
            j = i + 1
            in_class = False
            first_in_class = True
            buf = []
            ok = False
            while j < n:
                ch = code[j]
                if ch == "\\":
                    buf.append(code[j:j + 2])
                    j += 2
                    first_in_class = False
                    continue
                if ch == "\n":
                    break
                if in_class:
                    if ch == "]" and not first_in_class:
                        in_class = False
                    first_in_class = False
                    buf.append(ch)
                    j += 1
                    continue
                if ch == "[":
                    in_class = True
                    first_in_class = True
                    buf.append(ch)
                    j += 1
                    continue
                if ch == "/":
                    ok = True
                    break
                buf.append(ch)
                j += 1
            if ok:
                out.append(("".join(buf), start_line))
                i = j + 1
                while i < n and code[i].isalpha():
                    i += 1
                prev_sig = "/"
                continue
        if not c.isspace():
            prev_sig = c
        i += 1
    return out


def class_spans(pat):
    """-> [(inner_text, negated)] for top-level bracket expressions"""
    res = []
    i, n = 0, len(pat)
    while i < n:
        if pat[i] == "\\":
            i += 2
            continue
        if pat[i] == "[":
            j = i + 1
            neg = False
            if j < n and pat[j] == "^":
                neg = True
                j += 1
            start = j
            while j < n and pat[j] != "]":
                if pat[j] == "\\":
                    j += 2
                else:
                    j += 1
            if j < n:
                res.append((pat[start:j], neg))
                i = j + 1
                continue
            return res
        i += 1
    return res


def check_pattern(pat):
    """-> FATAL problems only: ranges whose endpoints are out of order.

    Those are the ones glibc regcomp() rejects with REG_ERANGE, which ucode
    surfaces as "Invalid character range". Deliberately NOT reported here:
      * `A-Z` / `a-z` / `0-9`          -> intended ranges, perfectly legal
      * `\\s` `\\n` inside a class     -> legal, just means literal \\ s n
      * a trailing `-`                 -> literal hyphen, legal
      * `\\-` next to another `\\`     -> degenerate range `\\`..`\\`, compiles
                                         fine (upstream homeproxy does this)

    Why only fatal: this checker runs in the build and must not go red on
    upstream code that actually works. `warn_pattern()` covers the smells.
    """
    issues = []
    for inner, _neg in class_spans(pat):
        body = inner[1:] if inner.startswith("]") else inner
        for m in re.finditer(r"-", body):
            p = m.start()
            if p == 0 or p == len(body) - 1:
                continue
            a, b = body[p - 1], body[p + 1]
            if ord(a) > ord(b):
                issues.append(
                    f"`{a}-{b}` 是逆序字符范围 ({a}=U+{ord(a):04X} > "
                    f"{b}=U+{ord(b):04X}) -> regcomp() 返回 REG_ERANGE -> "
                    f"\"Invalid character range\"")
    return issues


def warn_pattern(pat):
    """-> non-fatal smells: `\\-` inside a class. POSIX has no escape there,
    so the '-' silently becomes a range operator. Often a degenerate range
    (`\\`..`\\`) that still compiles -- upstream homeproxy.uc does exactly
    this -- but it is never what the author meant, and on a whitelist it
    silently admits a literal backslash.
    """
    out = []
    for inner, _neg in class_spans(pat):
        body = inner[1:] if inner.startswith("]") else inner
        for _m in re.finditer(r"\\-|-(?=\\)", body):
            out.append(
                "`\\-` — POSIX 括号表达式里反斜杠不是转义符, 这个 `-` 会变成"
                "范围运算符; 把 `-` 移到类尾即可")
    return out


def ucode_code(path, src):
    """.ut templates only contribute their {% %}/{{ }} blocks (skip CSS)."""
    if path.endswith(".ut"):
        return "\n".join((m.group(2) or "") + "\n" + (m.group(4) or "")
                         for m in SPAN.finditer(src))
    return src


def check_text(path, src):
    """-> [(lineno, pattern, fatal_issue)]"""
    out = []
    for pat, ln in extract_regexes(ucode_code(path, src)):
        for iss in check_pattern(pat):
            out.append((ln, pat, iss))
    return out


def warn_text(path, src):
    """-> [(lineno, pattern, warning)]"""
    out = []
    for pat, ln in extract_regexes(ucode_code(path, src)):
        for iss in warn_pattern(pat):
            out.append((ln, pat, iss))
    return out


def iter_files(targets):
    for t in targets:
        if os.path.isdir(t):
            for dp, _, fs in os.walk(t):
                for f in sorted(fs):
                    p = os.path.join(dp, f)
                    if f.endswith((".ut", ".uc")) or "/rpcd/ucode/" in p.replace(os.sep, "/"):
                        yield p
        elif os.path.isfile(t):
            yield t


def main(argv):
    targets = argv[1:]
    if not targets:
        print(__doc__)
        return 2
    paths = list(iter_files(targets))
    total = bad = warn = 0
    for p in paths:
        try:
            src = open(p, encoding="utf-8").read()
        except Exception:
            continue
        pats = extract_regexes(ucode_code(p, src))
        total += len(pats)
        for ln, pat, iss in check_text(p, src):
            bad += 1
            print(f"::error:: {p}:{ln}  /{pat}/  -> {iss}")
        for ln, pat, iss in warn_text(p, src):
            warn += 1
            print(f"::warning:: {p}:{ln}  /{pat}/  -> {iss}")
    print(f"[posix-re] {len(paths)} 个文件, {total} 条正则字面量, "
          f"致命 {bad} 处, 告警 {warn} 处")
    if bad:
        print("::error::存在逆序字符范围的 ucode 正则, 会在运行时抛 "
              "\"Invalid character range\" 让整个 LuCI 500")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
