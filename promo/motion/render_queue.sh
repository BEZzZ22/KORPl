#!/bin/bash
# renders films listed in out/queue.txt one by one; "END" stops it
cd "$(dirname "$0")"; touch out/queue.txt out/done.txt
while true; do
  next=$(grep -vxF -f out/done.txt out/queue.txt | head -1)
  if [ "$next" = "END" ]; then echo ALLDONE; exit 0; fi
  if [ -z "$next" ]; then sleep 20; continue; fi
  if ./render_full.sh $next; then echo $next >> out/done.txt; else echo "FAIL $next"; echo $next >> out/done.txt; fi
done
