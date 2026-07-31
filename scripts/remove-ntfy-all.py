#!/usr/bin/env python3
"""Remove ALL ntfy references from the active codebase in one pass."""

import os, re

BASE = '/home/z/my-project/src'

########################################################################
# 1. settings-view.tsx — full rewrite of ntfy sections
########################################################################
f = os.path.join(BASE, 'components/crm/settings-view.tsx')
with open(f, 'r', encoding='utf-8') as fh:
    lines = fh.readlines()

out = []
i = 0
while i < len(lines):
    line = lines[i]
    raw = line.rstrip('\n')
    
    # --- Imports ---
    if 'Shield, Eye, EyeOff, Search, Smartphone, ArrowRight, Check, Copy, ExternalLink' in raw:
        out.append("import { Moon, Sun, CheckCircle2, Circle, User, Loader2, Save, CalendarDays, Link2, Unlink, Phone, Send, MessageCircle, Bell, Smartphone, Check } from 'lucide-react';\n")
        i += 1; continue

    # --- Replace notifChannel + ntfy states ---
    if 'canal' in raw and 'Ntfy' in raw:
        out.append('  // Notifica\u00e7\u00f5es (Telegram)\n')
        out.append('  const [notifLoading, setNotifLoading] = useState(true);\n')
        # skip 2 lines (old notifChannel + notifLoading)
        i += 1
        while i < len(lines) and 'const [tgConfigured' not in lines[i]:
            i += 1
        continue

    # --- Skip ntfy state block ---
    if raw.strip() == '// Ntfy' and i+1 < len(lines) and 'ntfyConnected' in lines[i+1]:
        while i < len(lines) and 'showNtfyToken' not in lines[i]:
            i += 1
        i += 1  # skip showNtfyToken line
        continue

    # --- Replace notification useEffect ---
    if 'Telegram + Ntfy em paralelo' in raw:
        out.append('    // Verificar status das notifica\u00e7\u00f5es (Telegram)\n')
        out.append("    fetch('/api/settings/telegram')\n")
        out.append('      .then((r) => r.json())\n')
        out.append('      .then((tgData) => {\n')
        out.append('        setTgConfigured(tgData.botConfigured === true);\n')
        out.append("        setTgConnected(tgData.configured === true);\n")
        out.append("        setTgChatId(tgData.telegramChatId || '');\n")
        out.append('      })\n')
        out.append('      .catch(() => {})\n')
        out.append("      .finally(() => setNotifLoading(false));\n")
        while i < len(lines) and 'setNotifLoading(false))' not in lines[i]:
            i += 1
        i += 1
        continue

    # --- Clean saveTelegramChatId ---
    if 'setNtfyConnected(false)' in raw and i > 0 and 'setTgConnected(true)' in lines[i-1]:
        while i < len(lines) and "toast.success('Telegram vinculado" not in lines[i]:
            i += 1
        continue

    # --- Clean disconnectTelegram ---
    if 'setNotifChannel(null)' in raw:
        i += 1; continue

    # --- Skip ntfy handlers block ---
    if 'Ntfy handlers' in raw and '//' in raw:
        while i < len(lines):
            if 'fetchNtfyCredentials' in lines[i]:
                while i < len(lines) and lines[i].strip() != '}':
                    i += 1
                i += 1; break
            i += 1
        continue

    # --- Card className ---
    if "notifChannel === 'telegram' && tgConnected" in raw:
        # Skip until we find the closing of the ternary
        out.append('          tgConnected\n')
        i += 1
        # skip: ? 'border-blue...' line
        if i < len(lines) and 'border-blue' in lines[i]:
            i += 1
        # skip: : notifChannel === 'ntfy' ... line
        if i < len(lines) and 'ntfy' in lines[i].lower():
            i += 1
        # skip: ? 'border-violet...' line
        if i < len(lines) and 'violet' in lines[i]:
            i += 1
        continue

    # --- Badge ---
    if '(tgConnected || ntfyConnected)' in raw:
        out.append('              {tgConnected && (\n')
        out.append('                <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1">\n')
        # skip old badge lines until </Badge>
        while i < len(lines) and '</Badge>' not in lines[i]:
            i += 1
        i += 1  # skip </Badge>
        # skip the closing )}
        while i < len(lines) and ')' not in lines[i]:
            i += 1
        i += 1  # skip )}
        continue

    # --- CardDescription ---
    if 'Escolha um canal para receber alertas' in raw:
        out.append('                  Receba alertas instant\u00e2neos no Telegram quando novos leads chegarem\n')
        i += 1; continue

    # --- Channel selector button (Telegram) ---
    if "notifChannel === 'telegram'" in raw and 'onClick' in raw:
        # skip the entire telegram selector button until its closing </button>
        depth = 0
        while i < len(lines):
            if '<button' in lines[i]: depth += 1
            if '</button>' in lines[i]:
                depth -= 1
                if depth <= 0:
                    i += 1; break
            i += 1
        continue

    # --- Channel selector button (Ntfy) ---
    if "notifChannel === 'ntfy'" in raw and 'onClick' in raw:
        depth = 0
        while i < len(lines):
            if '<button' in lines[i]: depth += 1
            if '</button>' in lines[i]:
                depth -= 1
                if depth <= 0:
                    i += 1; break
            i += 1
        continue

    # --- Channel Selector comment ---
    if 'Channel Selector' in raw and '───' in raw:
        # skip the entire grid div
        depth = 0
        while i < len(lines):
            if '<div' in lines[i]: depth += 1
            if '</div>' in lines[i]:
                depth -= 1
                if depth <= 0:
                    i += 1; break
            i += 1
        # skip the <Separator /> after it
        while i < len(lines) and '<Separator' not in lines[i]:
            i += 1
        if i < len(lines):
            i += 1  # skip Separator
        continue

    # --- NTFY CONTENT section ---
    if 'NTFY CONTENT' in raw and '══' in raw:
        # Skip until we find the matching closing )}
        # This is inside a {notifChannel === 'ntfy' && ( ... )}
        depth = 0
        started = False
        while i < len(lines):
            if 'notifChannel' in lines[i] or 'ntfyConnected' in lines[i]:
                started = True
            if started:
                if lines[i].strip() == ')}':
                    i += 1; break
            i += 1
        continue

    # --- TELEGRAM CONTENT unwrap ---
    if 'TELEGRAM CONTENT' in raw and '══' in raw:
        # Skip this comment line
        i += 1
        # The next line is {notifChannel === 'telegram' && ( — skip it
        if i < len(lines) and 'notifChannel' in lines[i]:
            i += 1
        continue

    # --- Closing of telegram conditional )} ---
    # After the telegram content ends, there's a )} that we need to skip
    # This is tricky — we need to detect the closing of {notifChannel === 'telegram' && (...)}
    # We'll handle this by checking if the current line is just )} after telegram content
    # Actually this is handled by the flow above

    out.append(line)
    i += 1

# Also need to remove the closing </> and )} after the telegram content
# The telegram content was unwrapped, so we need to remove the </>  )} that followed
final = []
skip_next_close_fragment = False
for idx, line in enumerate(out):
    raw = line.rstrip('\n')
    # Detect the pattern: </>  followed by )}
    if raw.strip() == '</>' and idx + 1 < len(out) and out[idx+1].strip() == ')}':
        continue  # skip </>
    if skip_next_close_fragment and raw.strip() == ')}':
        skip_next_close_fragment = False
        continue
    if raw.strip() == '</>':
        skip_next_close_fragment = True
        continue
    final.append(line)

with open(f, 'w', encoding='utf-8') as fh:
    fh.writelines(final)
print(f'settings-view.tsx: {len(lines)} -> {len(final)} lines')

########################################################################
# 2. meta-leads/route.ts — remove ntfy import and notification
########################################################################
f = os.path.join(BASE, 'app/api/webhooks/meta-leads/route.ts')
with open(f, 'r', encoding='utf-8') as fh:
    c = fh.read()

c = c.replace(
    "import { notifyNewLead as notifyNewLeadTelegram } from '@/lib/telegram';\nimport { notifyNewLead as notifyNewLeadNtfy } from '@/lib/ntfy';",
    "import { notifyNewLead } from '@/lib/telegram';"
)
c = c.replace(
    "select: { telegramChatId: true, ntfyTopic: true, ntfyToken: true },",
    "select: { telegramChatId: true },"
)
c = c.replace("notifyNewLeadTelegram(user.telegramChatId, leadData)", "notifyNewLead(user.telegramChatId, leadData)")
# Remove ntfy notification block
ntfy_block = '''              if (user?.ntfyTopic && user?.ntfyToken) {
                notifyNewLeadNtfy(user.ntfyTopic, user.ntfyToken, leadData).catch((err) =>
                  console.warn('[Meta Webhook] Falha na notifica\u00e7\u00e3o Ntfy:', err),
                );
              }'''
c = c.replace(ntfy_block, '')

with open(f, 'w', encoding='utf-8') as fh:
    fh.write(c)
print('meta-leads/route.ts: cleaned')

########################################################################
# 3. public-lead/route.ts — remove ntfy import and notification
########################################################################
f = os.path.join(BASE, 'app/api/enterprises/public-lead/route.ts')
with open(f, 'r', encoding='utf-8') as fh:
    c = fh.read()

c = c.replace(
    "import { notifyNewLead } from '@/lib/telegram';\nimport { notifyNewLead as notifyNewLeadNtfy } from '@/lib/ntfy';",
    "import { notifyNewLead } from '@/lib/telegram';"
)
c = c.replace(
    "// Fetch assigned user's telegramChatId and ntfy config (may be null)",
    "// Fetch assigned user's telegramChatId (may be null)"
)
c = c.replace(
    "select: { telegramChatId: true, ntfyTopic: true, ntfyToken: true },",
    "select: { telegramChatId: true },"
)
# Remove ntfy notification block
ntfy_block = '''
        // Ntfy notification
        if (user?.ntfyTopic && user?.ntfyToken) {
          notifyNewLeadNtfy(user.ntfyTopic, user.ntfyToken, leadData).catch((err) => console.warn('[Public Lead] Falha na notifica\u00e7\u00e3o:', err));
        }'''
c = c.replace(ntfy_block, '')

with open(f, 'w', encoding='utf-8') as fh:
    fh.write(c)
print('public-lead/route.ts: cleaned')

########################################################################
# 4. telegram/route.ts — remove mutual exclusion
########################################################################
f = os.path.join(BASE, 'app/api/settings/telegram/route.ts')
with open(f, 'r', encoding='utf-8') as fh:
    c = fh.read()

c = c.replace(
    "// Connect Telegram and deactivate Ntfy (mutual exclusion)\n      await db.user.update({\n        where: { id: user.id },\n        data: { telegramChatId: String(chatId), ntfyTopic: null, ntfyToken: null },",
    "// Connect Telegram\n      await db.user.update({\n        where: { id: user.id },\n        data: { telegramChatId: String(chatId) },"
)

with open(f, 'w', encoding='utf-8') as fh:
    fh.write(c)
print('telegram/route.ts: cleaned')

########################################################################
# 5. prisma/schema.prisma — remove ntfy fields
########################################################################
f = '/home/z/my-project/prisma/schema.prisma'
with open(f, 'r', encoding='utf-8') as fh:
    c = fh.read()

c = c.replace(
    '  telegramChatId    String?  @unique @map("telegramChatId")\n  ntfyTopic         String?  @unique @map("ntfyTopic")\n  ntfyToken         String?  @map("ntfyToken")\n  createdAt',
    '  telegramChatId    String?  @unique @map("telegramChatId")\n  createdAt'
)

with open(f, 'w', encoding='utf-8') as fh:
    fh.write(c)
print('schema.prisma: cleaned')

print('\nAll done!')
