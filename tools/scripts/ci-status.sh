#!/bin/sh
# Usage: ci-status.sh <sha>  — waits for the GitHub Actions run of <sha>, prints jobs and failure annotations.
sha="$1"; api=https://api.github.com/repos/${GITHUB_REPO:-FannyIsPrettyCool/SilverCord}
for i in $(seq 1 150); do
  r=$(curl -s "$api/actions/runs?head_sha=$sha" | python3 -c "import json,sys; w=json.load(sys.stdin).get('workflow_runs') or []; print(w[0]['status'], w[0]['conclusion'], w[0]['id']) if w else print('none')" 2>/dev/null)
  case "$r" in completed*) break;; esac; sleep 20
done
echo "$sha $r"; id=$(echo "$r" | awk '{print $3}')
curl -s "$api/actions/runs/$id/jobs" | python3 -c "
import json,sys,urllib.request
for j in json.load(sys.stdin)['jobs']:
    print(j['name'], j['conclusion'], [s['name'] for s in j['steps'] if s['conclusion']=='failure'])
    if j['conclusion']=='failure':
        a=json.load(urllib.request.urlopen('$api/check-runs/%d/annotations'%j['id']))
        for x in a: print('  >', (x.get('title') or ''), '|', x.get('message','')[:1500].replace('\n','\n    '))
"
