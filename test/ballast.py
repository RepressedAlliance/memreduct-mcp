"""Hold N MiB of touched, idle memory for a while, like a bloated background app.

python ballast.py 4096 600   # 4 GiB for 10 minutes
"""
import sys
import time

mib, seconds = int(sys.argv[1]), int(sys.argv[2])
block = bytearray(mib * 1024 * 1024)
for i in range(0, len(block), 4096):  # touch every page so it is really resident
    block[i] = 1
print(f'holding {mib} MiB for {seconds} s', flush=True)
time.sleep(seconds)
