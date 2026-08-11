import re

filepath = '/home/z/my-project/src/app/api/tracking/dashboard/route.ts'

with open(filepath, 'r') as f:
    lines = f.readlines()

# 1. Insert safe() definition after line 4 (Prisma import)
safe_def = '''
// Wrapper: individual query failure won't kill the entire dashboard
const safe = <T,>(p: Promise<T>): Promise<T | []> =>
  p.catch((err: unknown) => {
    console.warn('[Tracking Dashboard] Query failed:', (err as Error)?.message || err);
    return [] as unknown as T;
  });

'''
lines.insert(4, safe_def)

# 2. Find lines starting with '      db.$queryRaw' and wrap with safe(
for i in range(len(lines)):
    stripped = lines[i].strip()
    if stripped.startswith('db.$queryRaw'):
        # Add safe( before db.$queryRaw
        indent = lines[i][:len(lines[i]) - len(lines[i].lstrip())]
        lines[i] = f'{indent}safe({stripped}'
        print(f'Line {i+1}: wrapped with safe()')

safe_count = sum(1 for l in lines if 'safe(db.$queryRaw' in l)
print(f'Total safe() wrapped queries: {safe_count}')

# 3. Find closing patterns and add extra )
# Each query ends with: `),  (middle queries) or `]);  (last query)
for i in range(len(lines)):
    # Match:      `,  ->      `)),  (middle queries)
    if lines[i].strip() == '`,':
        # Check next line
        if i + 1 < len(lines) and lines[i+1].strip() == '),':
            indent = lines[i+1][:len(lines[i+1]) - len(lines[i+1].lstrip())]
            lines[i+1] = f'{indent})),\n'
            print(f'Line {i+2}: added extra ) to mid-query closing')
        elif i + 1 < len(lines) and lines[i+1].strip() == ']);':
            indent = lines[i+1][:len(lines[i+1]) - len(lines[i+1].lstrip())]
            lines[i+1] = f'{indent})]);\n'
            print(f'Line {i+2}: added extra ) to last query closing')

with open(filepath, 'w') as f:
    f.writelines(lines)

print('Done!')
