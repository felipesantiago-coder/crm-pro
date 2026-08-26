#!/usr/bin/env python3
"""Remove all ntfy references from settings-view.tsx."""

FILE = '/home/z/my-project/src/components/crm/settings-view.tsx'

with open(FILE, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Build output line by line
out = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # 1. Fix imports
    if "Shield, Eye, EyeOff, Search, Smartphone, ArrowRight, Check, Copy, ExternalLink" in line:
        out.append("import { Moon, Sun, CheckCircle2, Circle, User, Loader2, Save, CalendarDays, Link2, Unlink, Phone, Send, MessageCircle, Bell, Smartphone, Check } from 'lucide-react';\n")
        i += 1
        continue
    
    # 2. Replace notifChannel + ntfy states with Telegram-only
    if "canal \u00fanico: Telegram ou Ntfy" in line:
        out.append("  // Notifica\u00e7\u00f5es (Telegram)\n")
        out.append("  const [notifLoading, setNotifLoading] = useState(true);\n")
        i += 1
        # Skip the old notifChannel and notifLoading lines
        while i < len(lines) and "const [tgConfigured" not in lines[i]:
            i += 1
        continue
    
    # 3. Skip ntfy state variables block
    if line.strip() == "// Ntfy" and i + 1 < len(lines) and "ntfyConnected" in lines[i + 1]:
        # Skip until we pass showNtfyToken
        while i < len(lines) and "showNtfyToken" not in lines[i]:
            i += 1
        i += 1  # skip the showNtfyToken line itself
        continue
    
    # 4. Replace the notification loading useEffect
    if "Telegram + Ntfy em paralelo" in line:
        out.append("    // Verificar status das notifica\u00e7\u00f5es (Telegram)\n")
        out.append("    fetch('/api/settings/telegram')\n")
        out.append("      .then((r) => r.json())\n")
        out.append("      .then((tgData) => {\n")
        out.append("        setTgConfigured(tgData.botConfigured === true);\n")
        out.append("        setTgConnected(tgData.configured === true);\n")
        out.append("        setTgChatId(tgData.telegramChatId || '');\n")
        out.append("      })\n")
        out.append("      .catch(() => {})\n")
        out.append("      .finally(() => setNotifLoading(false));\n")
        # Skip until we find the closing of the Promise.all block
        while i < len(lines) and "setNotifLoading(false))" not in lines[i]:
            i += 1
        i += 1  # skip the closing line
        continue
    
    # 5. Clean saveTelegramChatId - remove ntfy resets
    if "setNtfyConnected(false)" in line and "setTgConnected(true)" in lines[i-1]:
        # Skip all ntfy reset lines until toast.success
        while i < len(lines) and "toast.success('Telegram vinculado" not in lines[i]:
            i += 1
        continue
    
    # 6. Clean disconnectTelegram - remove setNotifChannel(null)
    if "setNotifChannel(null)" in line:
        i += 1
        continue
    
    # 7. Skip all ntfy handlers (from comment through fetchNtfyCredentials)
    if "Ntfy handlers" in line and "//" in line:
        # Skip until we find the end of fetchNtfyCredentials
        while i < len(lines):
            if "fetchNtfyCredentials" in lines[i]:
                # Find the closing brace
                while i < len(lines) and lines[i].strip() != "}":
                    i += 1
                i += 1  # skip closing brace
                break
            i += 1
        continue
    
    # 8. Fix Card className - remove ntfy condition
    if "notifChannel === 'telegram' && tgConnected" in line:
        out.append("          tgConnected\n")
        i += 1
        # Skip the old telegram condition line (already replaced above)
        # and the ntfy condition lines
        while i < len(lines) and ("ntfyConnected" in lines[i] or "border-violet" in lines[i]):
            i += 1
        # The next line should be "            : ''" or similar - keep it
        continue
    
    # 9. Fix Badge - remove ntfy condition
    if "(tgConnected || ntfyConnected)" in line:
        out.append("              {tgConnected && (\n")
        i += 1
        # Skip old badge class logic
        while i < len(lines) and ("notifChannel" in lines[i] or "bg-violet" in lines[i]):
            i += 1
        # Replace with simple badge class
        out.append("                <Badge className=\"bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1\">\n")
        continue
    
    # 10. Replace CardDescription
    if "Escolha um canal para receber alertas" in line:
        out.append("                  Receba alertas instant\u00e2neos no Telegram quando novos leads chegarem\n")
        i += 1
        continue
    
    # 11. Replace the entire CardContent for notifications
    if '<CardContent className="space-y-5">' in line:
        # Check if this is the notification card (next non-empty line should have notifLoading)
        j = i + 1
        while j < len(lines) and lines[j].strip() == "":
            j += 1
        if j < len(lines) and "notifLoading" in lines[j]:
            # This is the notification CardContent - replace it entirely
            out.append("          <CardContent className=\"space-y-5\">\n")
            out.append("            {notifLoading ? (\n")
            out.append("              <div className=\"flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center\">\n")
            out.append("                <Loader2 className=\"h-4 w-4 animate-spin\" />\n")
            out.append("                Verificando...\n")
            out.append("              </div>\n")
            out.append("            ) : !tgConfigured ? (\n")
            out.append("              <div className=\"p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30\">\n")
            out.append("                <div className=\"flex items-center gap-2 mb-2\">\n")
            out.append("                  <div className=\"w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center\">\n")
            out.append("                    <Circle className=\"h-3.5 w-3.5 text-amber-600 dark:text-amber-400\" />\n")
            out.append("                  </div>\n")
            out.append("                  <p className=\"text-sm font-semibold text-amber-700 dark:text-amber-300\">Bot n\u00e3o configurado</p>\n")
            out.append("                </div>\n")
            out.append("                <p className=\"text-xs text-amber-600 dark:text-amber-400\">\n")
            out.append("                  O bot do Telegram n\u00e3o est\u00e1 dispon\u00edvel no momento. Solicite ao administrador que configure o TELEGRAM_BOT_TOKEN nas vari\u00e1veis de ambiente.\n")
            out.append("                </p>\n")
            out.append("              </div>\n")
            out.append("            ) : tgConnected ? (\n")
            out.append("              <div className=\"space-y-5\">\n")
            out.append("                <div className=\"flex items-center justify-between\">\n")
            out.append("                  <div className=\"flex items-center gap-2\">\n")
            out.append("                    <div className=\"w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center\">\n")
            out.append("                      <Check className=\"h-4 w-4 text-blue-600 dark:text-blue-400\" />\n")
            out.append("                    </div>\n")
            out.append("                    <div>\n")
            out.append("                      <p className=\"text-sm font-medium text-blue-700 dark:text-blue-300\">Telegram conectado</p>\n")
            out.append("                      <p className=\"text-[10px] text-muted-foreground\">Chat ID: <code className=\"font-mono\">{tgChatId}</code></p>\n")
            out.append("                    </div>\n")
            out.append("                  </div>\n")
            out.append("                  <div className=\"flex items-center gap-2\">\n")
            out.append("                    <Button\n")
            out.append("                      variant=\"outline\"\n")
            out.append("                      size=\"sm\"\n")
            out.append("                      onClick={testTelegram}\n")
            out.append("                      disabled={tgTesting}\n")
            out.append("                      className=\"text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800/50 dark:hover:bg-blue-950/30\"\n")
            out.append("                    >\n")
            out.append("                      {tgTesting ? <><Loader2 className=\"h-4 w-4 mr-1.5 animate-spin\" /> Enviando...</> : <><Send className=\"h-4 w-4 mr-1.5\" /> Testar</>}\n")
            out.append("                    </Button>\n")
            out.append("                    <Button\n")
            out.append("                      variant=\"outline\"\n")
            out.append("                      size=\"sm\"\n")
            out.append("                      onClick={disconnectTelegram}\n")
            out.append("                      disabled={tgSaving}\n")
            out.append("                      className=\"text-destructive hover:text-destructive\"\n")
            out.append("                    >\n")
            out.append("                      {tgSaving ? <><Loader2 className=\"h-4 w-4 mr-1.5 animate-spin\" /> Desativando...</> : <><Unlink className=\"h-4 w-4 mr-1.5\" /> Desativar</>}\n")
            out.append("                    </Button>\n")
            out.append("                  </div>\n")
            out.append("                </div>\n")
            out.append("                <div className=\"p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/20\">\n")
            out.append("                  <p className=\"text-xs font-semibold text-blue-600 dark:text-blue-400 mb-3\">O que voce recebera</p>\n")
            out.append("                  <div className=\"grid grid-cols-2 gap-2\">\n")
            out.append("                    {['Nome e telefone do lead', 'E-mail do lead', 'Nome do empreendimento', 'Campanha Meta Ads', 'Respostas do formulario'].map((item) => (\n")
            out.append("                      <div key={item} className=\"flex items-center gap-1.5 text-xs text-muted-foreground\">\n")
            out.append("                        <CheckCircle2 className=\"h-3 w-3 text-blue-500 flex-shrink-0\" />\n")
            out.append("                        <span>{item}</span>\n")
            out.append("                      </div>\n")
            out.append("                    ))}\n")
            out.append("                  </div>\n")
            out.append("                </div>\n")
            out.append("              </div>\n")
            out.append("            ) : (\n")
            out.append("              <div className=\"space-y-4\">\n")
            out.append("                <div className=\"space-y-2\">\n")
            out.append("                  <Label htmlFor=\"tg-chat-id\" className=\"text-sm font-medium\">Seu Chat ID</Label>\n")
            out.append("                  <div className=\"flex gap-2\">\n")
            out.append("                    <Input\n")
            out.append("                      id=\"tg-chat-id\"\n")
            out.append("                      placeholder=\"Ex: 123456789\"\n")
            out.append("                      value={tgChatId}\n")
            out.append("                      onChange={(e) => setTgChatId(e.target.value)}\n")
            out.append("                      className=\"font-mono text-sm\"\n")
            out.append("                    />\n")
            out.append("                    <Button\n")
            out.append("                      onClick={saveTelegramChatId}\n")
            out.append("                      disabled={tgSaving || !tgChatId.trim()}\n")
            out.append("                      className=\"bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0\"\n")
            out.append("                    >\n")
            out.append("                      {tgSaving ? <><Loader2 className=\"h-4 w-4 animate-spin\" /></> : <><Link2 className=\"h-4 w-4 mr-1.5\" /> Vincular</>}\n")
            out.append("                    </Button>\n")
            out.append("                  </div>\n")
            out.append("                </div>\n")
            out.append("\n")
            out.append("                <Separator />\n")
            out.append("\n")
            out.append("                <div className=\"p-4 rounded-xl bg-muted/30 border border-border/50\">\n")
            out.append("                  <p className=\"text-sm font-semibold mb-4 flex items-center gap-2\">\n")
            out.append("                    <Smartphone className=\"h-4 w-4 text-blue-500\" />\n")
            out.append("                    Passo a passo para configurar\n")
            out.append("                  </p>\n")
            out.append("                  <div className=\"space-y-4\">\n")
            out.append("                    <div className=\"flex gap-3\">\n")
            out.append("                      <div className=\"flex flex-col items-center\">\n")
            out.append("                        <div className=\"w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0\">1</div>\n")
            out.append("                        <div className=\"w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1\" />\n")
            out.append("                      </div>\n")
            out.append("                      <div className=\"pb-4\">\n")
            out.append("                        <p className=\"text-sm font-medium\">Abra o Telegram e busque por <strong>@userinfobot</strong></p>\n")
            out.append("                        <p className=\"text-xs text-muted-foreground mt-0.5\">Ele e um bot oficial que diz qual e o seu Chat ID</p>\n")
            out.append("                      </div>\n")
            out.append("                    </div>\n")
            out.append("                    <div className=\"flex gap-3\">\n")
            out.append("                      <div className=\"flex flex-col items-center\">\n")
            out.append("                        <div className=\"w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0\">2</div>\n")
            out.append("                        <div className=\"w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1\" />\n")
            out.append("                      </div>\n")
            out.append("                      <div className=\"pb-4\">\n")
            out.append("                        <p className=\"text-sm font-medium\">Envie qualquer mensagem para ele</p>\n")
            out.append("                        <p className=\"text-xs text-muted-foreground mt-0.5\">Pode ser um \"oi\" \u2014 ele respondera automaticamente</p>\n")
            out.append("                      </div>\n")
            out.append("                    </div>\n")
            out.append("                    <div className=\"flex gap-3\">\n")
            out.append("                      <div className=\"flex flex-col items-center\">\n")
            out.append("                        <div className=\"w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0\">3</div>\n")
            out.append("                        <div className=\"w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1\" />\n")
            out.append("                      </div>\n")
            out.append("                      <div className=\"pb-4\">\n")
            out.append("                        <p className=\"text-sm font-medium\">Copie o <strong>Chat ID</strong> que ele respondeu</p>\n")
            out.append("                        <p className=\"text-xs text-muted-foreground mt-0.5\">Sera um numero, por exemplo: <code className=\"bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]\">7123456789</code></p>\n")
            out.append("                      </div>\n")
            out.append("                    </div>\n")
            out.append("                    <div className=\"flex gap-3\">\n")
            out.append("                      <div className=\"flex flex-col items-center\">\n")
            out.append("                        <div className=\"w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0\">\n")
            out.append("                          <Check className=\"h-4 w-4\" />\n")
            out.append("                        </div>\n")
            out.append("                      </div>\n")
            out.append("                      <div>\n")
            out.append("                        <p className=\"text-sm font-medium\">Cole o numero acima e clique em <strong>Vincular</strong></p>\n")
            out.append("                        <p className=\"text-xs text-muted-foreground mt-0.5\">Pronto! Voce recebera todas as notificacoes por aqui</p>\n")
            out.append("                      </div>\n")
            out.append("                    </div>\n")
            out.append("                  </div>\n")
            out.append("                </div>\n")
            out.append("              </div>\n")
            out.append("            )}\n")
            out.append("          </CardContent>\n")
            # Skip the old CardContent until we find </CardContent>
            i += 1
            depth = 0
            while i < len(lines):
                if '</CardContent>' in lines[i]:
                    i += 1
                    break
                i += 1
            continue
    
    out.append(line)
    i += 1

with open(FILE, 'w', encoding='utf-8') as f:
    f.writelines(out)

print("Successfully updated settings-view.tsx")
print(f"Original: {len(lines)} lines, New: {len(out)} lines")