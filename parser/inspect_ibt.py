"""Channel inventory for an .ibt file (Section 3 validation gate).

Usage: python inspect_ibt.py <file.ibt>
"""

import re
import sys

from proctor_parser.ibt import CORE_CHANNELS, IbtFile


def main(path: str) -> int:
    ibt = IbtFile.from_path(path)
    h = ibt.header
    print(f"file:        {path}")
    print(f"numVars:     {h.num_vars}")
    print(f"bufLen:      {h.buf_len}")
    print(f"tickRate:    {h.tick_rate}")
    print(f"records:     {ibt.record_count}")

    yaml_text = ibt.session_yaml()
    for key in ("TrackDisplayName", "TrackLength", "CarScreenName",
                "DriverCarRedLine", "EventType"):
        m = re.search(rf"^\s*{key}:\s*(.+)$", yaml_text, re.MULTILINE)
        print(f"{key}: {m.group(1).strip() if m else '<not found>'}")

    missing = ibt.missing_core_channels()
    print(f"core channels: {len(CORE_CHANNELS) - len(missing)}/{len(CORE_CHANNELS)} present")
    if missing:
        print(f"MISSING: {missing}")
        return 1
    print("all 42 core channels present")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
