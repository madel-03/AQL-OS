from pathlib import Path


def make_plan(folder):
    root = Path(folder).resolve(strict=True)
    moves = []
    for src in sorted(root.iterdir(), key=lambda p: p.name.casefold()):
        if src.is_symlink() or not src.is_file() or src.name.startswith("."):
            continue
        extension = src.suffix[1:].lower()
        group = extension.upper() + " files" if extension.isascii() and extension.isalnum() else "Other files"
        dst = root / group / src.name
        if dst.parent.resolve() != dst.parent or dst.exists():
            continue
        stat = src.stat()
        moves.append((src, dst, stat.st_size, stat.st_mtime_ns))
    return moves


def apply_plan(moves, cancelled):
    done = []
    failures = []
    for src, dst, size, mtime in moves:
        if cancelled.is_set():
            break
        try:
            if src.resolve() != src or dst.parent.resolve() != dst.parent:
                raise ValueError("Path changed")
            stat = src.stat()
            if (size, mtime) != (stat.st_size, stat.st_mtime_ns):
                raise ValueError("File changed")
            dst.parent.mkdir(exist_ok=True)
            # Windows rename refuses to replace an existing destination.
            if dst.exists():
                raise FileExistsError(dst.name)
            src.rename(dst)
            done.append((dst, src, size, mtime))
        except (OSError, ValueError) as error:
            failures.append(f"{src.name}: {error}")
    return done, failures
