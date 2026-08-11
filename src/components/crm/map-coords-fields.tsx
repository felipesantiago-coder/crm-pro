'use client';

import { MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface MapCoordsFieldsProps {
  latitude: string;
  longitude: string;
  onLatitudeChange: (v: string) => void;
  onLongitudeChange: (v: string) => void;
  disabled?: boolean;
}

export function MapCoordsFields({ latitude, longitude, onLatitudeChange, onLongitudeChange, disabled }: MapCoordsFieldsProps) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-1.5">
        <MapPin className="h-4 w-4" />
        Coordenadas do Mapa
        <span className="text-muted-foreground font-normal text-xs">(opcional)</span>
      </Label>
      <p className="text-xs text-muted-foreground">
        {"Informe a latitude e longitude para posicionar o mapa na landing page. Se não preenchido, o sistema buscará automaticamente pelo endereço."}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="edit-lat" className="text-xs text-muted-foreground">Latitude</Label>
          <Input
            id="edit-lat"
            type="number"
            step="any"
            placeholder="Ex: -15.8152"
            value={latitude}
            onChange={(e) => onLatitudeChange(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit-lng" className="text-xs text-muted-foreground">Longitude</Label>
          <Input
            id="edit-lng"
            type="number"
            step="any"
            placeholder="Ex: -48.0960"
            value={longitude}
            onChange={(e) => onLongitudeChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}
