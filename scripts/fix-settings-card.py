#!/usr/bin/env python3
"""Replace the broken notification card in settings-view.tsx."""

FILE = '/home/z/my-project/src/components/crm/settings-view.tsx'
with open(FILE, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Lines 1-420 (indices 0-419) are the correct part (up to and including Google Calendar card closing)
# Line 421 starts the broken NOTIFICAÇÕES section
# Find the NOTIFICAÇÕES line
notif_start = None
for idx, line in enumerate(lines):
    if 'NOTIFIC' in line and '=' in line:
        notif_start = idx
        break

if notif_start is None:
    print('ERROR: Could not find NOTIFICAÇÕES section')
    exit(1)

print(f'Found notification section at line {notif_start + 1}')

# Keep everything before the notification section
before = lines[:notif_start]

# Append the correct notification card + grid closing + component closing
notification_card = '''        {/* ==================== NOTIFICAÇÕES DE LEADS ==================== */}
        <Card className={`hover:shadow-md transition-shadow duration-200 col-span-1 lg:col-span-2 ${
          tgConnected
            ? 'border-blue-200 dark:border-blue-800/50 bg-blue-50/30 dark:bg-blue-950/10'
            : ''
        }`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-500" />
                  Notificações de Leads
                </CardTitle>
                <CardDescription className="mt-1">
                  Receba alertas instantâneos no Telegram quando novos leads chegarem
                </CardDescription>
              </div>
              {tgConnected && (
                <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  Ativo
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {notifLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verificando...
              </div>
            ) : !tgConfigured ? (
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                    <Circle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Bot não configurado</p>
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  O bot do Telegram não está disponível no momento. Solicite ao administrador que configure o TELEGRAM_BOT_TOKEN.
                </p>
              </div>
            ) : tgConnected ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                      <Check className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Telegram conectado</p>
                      <p className="text-[10px] text-muted-foreground">Chat ID: <code className="font-mono">{tgChatId}</code></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={testTelegram}
                      disabled={tgTesting}
                      className="text-blue-600 border-blue-200 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-800/50 dark:hover:bg-blue-950/30"
                    >
                      {tgTesting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Enviando...</> : <><Send className="h-4 w-4 mr-1.5" /> Testar</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={disconnectTelegram}
                      disabled={tgSaving}
                      className="text-destructive hover:text-destructive"
                    >
                      {tgSaving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Desativando...</> : <><Unlink className="h-4 w-4 mr-1.5" /> Desativar</>}
                    </Button>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/20">
                  <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-3">O que voce recebera</p>
                  <div className="grid grid-cols-2 gap-2">
                    {['Nome e telefone do lead', 'E-mail do lead', 'Nome do empreendimento', 'Campanha Meta Ads', 'Respostas do formulario'].map((item) => (
                      <div key={item} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="h-3 w-3 text-blue-500 flex-shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="tg-chat-id" className="text-sm font-medium">Seu Chat ID</Label>
                  <div className="flex gap-2">
                    <Input
                      id="tg-chat-id"
                      placeholder="Ex: 123456789"
                      value={tgChatId}
                      onChange={(e) => setTgChatId(e.target.value)}
                      className="font-mono text-sm"
                    />
                    <Button
                      onClick={saveTelegramChatId}
                      disabled={tgSaving || !tgChatId.trim()}
                      className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0"
                    >
                      {tgSaving ? <><Loader2 className="h-4 w-4 animate-spin" /></> : <><Link2 className="h-4 w-4 mr-1.5" /> Vincular</>}
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                  <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <Smartphone className="h-4 w-4 text-blue-500" />
                    Passo a passo para configurar
                  </p>
                  <div className="space-y-4">
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">1</div>
                        <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">Abra o Telegram e busque por <strong>@userinfobot</strong></p>
                        <p className="text-xs text-muted-foreground mt-0.5">Ele e um bot oficial que diz qual e o seu Chat ID</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">2</div>
                        <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">Envie qualquer mensagem para ele</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Pode ser um \u201coi\u201d \u2014 ele respondera automaticamente</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 font-bold text-sm flex-shrink-0">3</div>
                        <div className="w-px flex-1 bg-blue-200 dark:bg-blue-800/40 mt-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium">Copie o <strong>Chat ID</strong> que ele respondeu</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Sera um numero, por exemplo: <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px]">7123456789</code></p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-8 h-8 rounded-full bg-blue-600 dark:bg-blue-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          <Check className="h-4 w-4" />
                        </div>
                      </div>
                      <div>
                        <p className="text-sm font-medium">Cole o numero acima e clique em <strong>Vincular</strong></p>
                        <p className="text-xs text-muted-foreground mt-0.5">Pronto! Voce recebera todas as notificacoes por aqui</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
'''

with open(FILE, 'w', encoding='utf-8') as f:
    f.writelines(before)
    f.write(notification_card)

print(f'File rewritten: {len(lines)} -> {len(before) + notification_card.count(chr(10))} lines')
