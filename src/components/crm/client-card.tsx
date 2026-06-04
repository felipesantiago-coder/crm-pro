'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Phone, Mail, MapPin, Building2, Clock, AlertTriangle, MessageCircle, PhoneCall, Target, Eye, CalendarDays, CalendarCheck, FileText, Handshake, Trophy, Ban } from 'lucide-react';
import { getWhatsAppUrl, getPhoneCallUrl } from '@/lib/phone-utils';

interface ClientTag {
  tag: {
    id: string;
    name: string;
    color: string;
  };
}

function needsUpdate(lastInteractionAt: string | null, createdAt: string, updatePeriod: number): boolean {
  const referenceDate = lastInteractionAt ? new Date(lastInteractionAt) : new Date(createdAt);
  const dueDate = new Date(referenceDate);
  dueDate.setDate(dueDate.getDate() + updatePeriod);
  return dueDate <= new Date();
}

function daysUntilUpdate(lastInteractionAt: string | null, createdAt: string, updatePeriod: number): number {
  const referenceDate = lastInteractionAt ? new Date(lastInteractionAt) : new Date(createdAt);
  const dueDate = new Date(referenceDate);
  dueDate.setDate(dueDate.getDate() + updatePeriod);
  const diff = dueDate.getTime() - new Date().getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

interface ClientCardProps {
  client: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    region: string | null;
    enterprise: string | null;
    enterpriseId?: string | null;
    linkedEnterprise?: {
      id: string;
      name: string;
      region: string | null;
      imageUrl: string | null;
    } | null;
    updatePeriod?: number;
    lastInteractionAt?: string | null;
    stage?: string;
    createdAt: string;
    tags: ClientTag[];
  };
  onClick: (id: string) => void;
}

const STAGE_BADGES: Record<string, { icon: typeof Target; color: string }> = {
  'LEAD': { icon: Target, color: 'bg-slate-100 text-slate-700 dark:bg-slate-800/50 dark:text-slate-300' },
  'PROSPECT': { icon: Eye, color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  'VISITA_AGENDADA': { icon: CalendarDays, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  'VISITA_REALIZADA': { icon: CalendarCheck, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  'CARTA_PROPOSTA': { icon: FileText, color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
  'CONTRATO_GERADO': { icon: Handshake, color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' },
  'FECHADO_GANHO': { icon: Trophy, color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  'FECHADO_PERDIDO': { icon: Ban, color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
};

const STAGE_LABELS: Record<string, string> = {
  'LEAD': 'Lead',
  'PROSPECT': 'Prospect',
  'VISITA_AGENDADA': 'Visita Agendada',
  'VISITA_REALIZADA': 'Visita Realizada',
  'CARTA_PROPOSTA': 'Carta Proposta',
  'CONTRATO_GERADO': 'Contrato Gerado',
  'FECHADO_GANHO': 'Fechado e Ganho',
  'FECHADO_PERDIDO': 'Fechado e Perdido',
};

export function ClientCard({ client, onClick }: ClientCardProps) {
  const period = client.updatePeriod || 30;
  const isOverdue = needsUpdate(client.lastInteractionAt || null, client.createdAt, period);
  const daysLeft = daysUntilUpdate(client.lastInteractionAt || null, client.createdAt, period);

  const whatsappUrl = client.phone ? getWhatsAppUrl(client.phone) : null;
  const phoneUrl = client.phone ? getPhoneCallUrl(client.phone) : null;

  function handleContactAction(e: React.MouseEvent, url: string) {
    e.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <Card
      className={`group cursor-pointer hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${
        isOverdue
          ? 'border-rose-200 dark:border-rose-800/50'
          : 'border-border/50'
      }`}
      onClick={() => onClick(client.id)}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
              {client.name}
            </h3>
          </div>
          {isOverdue ? (
            <Badge className="text-[10px] bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 border-rose-200 dark:border-rose-800/50 flex-shrink-0">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Vencido
            </Badge>
          ) : daysLeft <= 5 ? (
            <Badge className="text-[10px] bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800/50 flex-shrink-0">
              {daysLeft}d restantes
            </Badge>
          ) : null}
        </div>

        <div className="space-y-1.5">
          {client.phone && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground font-medium">
              <Phone className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{client.phone}</span>
            </div>
          )}
          {client.email && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground font-medium">
              <Mail className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{client.email}</span>
            </div>
          )}
          {client.region && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground font-medium">
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{client.region}</span>
            </div>
          )}
          {(client.enterprise || client.linkedEnterprise) && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground font-medium">
              {client.linkedEnterprise?.imageUrl ? (
                <div className="h-5 w-5 rounded overflow-hidden flex-shrink-0">
                  <img
                    src={client.linkedEnterprise.imageUrl}
                    alt={client.linkedEnterprise.name}
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                <Building2 className="h-3 w-3 flex-shrink-0" />
              )}
              <span className="truncate">
                {client.linkedEnterprise?.name || client.enterprise}
              </span>
              {client.linkedEnterprise?.region && (
                <Badge className="text-[9px] px-1 py-0 bg-muted/50">
                  {client.linkedEnterprise.region}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
          <Clock className="h-3 w-3 flex-shrink-0" />
          <span>
            Atualizar a cada {period} dias
            {client.lastInteractionAt && (
              <span className="ml-1">
                &bull; Última: {new Date(client.lastInteractionAt).toLocaleDateString('pt-BR')}
              </span>
            )}
          </span>
        </div>

        {client.stage && STAGE_BADGES[client.stage] && (
          <div className="flex items-center gap-1.5 mt-3">
            {(() => {
              const stageBadge = STAGE_BADGES[client.stage!];
              const StageIcon = stageBadge.icon;
              return (
                <Badge className={`text-[10px] px-2 py-0.5 gap-1 ${stageBadge.color}`}>
                  <StageIcon className="h-3 w-3" />
                  {STAGE_LABELS[client.stage!] || client.stage}
                </Badge>
              );
            })()}
          </div>
        )}

        {client.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {client.tags.map((ct) => (
              <Badge
                key={ct.tag.id}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 font-medium"
                style={{
                  backgroundColor: ct.tag.color + '20',
                  color: ct.tag.color,
                  borderColor: ct.tag.color + '40',
                }}
              >
                {ct.tag.name}
              </Badge>
            ))}
          </div>
        )}

        {/* Contact Action Buttons */}
        {(whatsappUrl || phoneUrl) && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/50">
            {whatsappUrl && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8 text-[11px] gap-1.5 border-green-200 dark:border-green-800/50 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950/30 hover:text-green-700 dark:hover:text-green-300"
                onClick={(e) => handleContactAction(e, whatsappUrl)}
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </Button>
            )}
            {phoneUrl && (
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-8 text-[11px] gap-1.5 border-blue-200 dark:border-blue-800/50 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:text-blue-700 dark:hover:text-blue-300"
                onClick={(e) => handleContactAction(e, phoneUrl)}
              >
                <PhoneCall className="h-3.5 w-3.5" />
                Ligar
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
