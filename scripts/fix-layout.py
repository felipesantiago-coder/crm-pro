import sys

path = '/home/z/my-project/src/app/layout.tsx'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('viewportFit: "cover",', 'maximumScale: 5,')
content = content.replace('overflow-x-hidden', '')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
