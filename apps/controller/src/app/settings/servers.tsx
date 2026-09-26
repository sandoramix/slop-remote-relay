import { DEFAULT_MQTT_URL, DEFAULT_STUN_URLS } from '@relay/protocol';
import { useState } from 'react';
import { KeyboardSafe } from '../../components/KeyboardSafe';
import { ScrollView } from 'react-native';
import { Divider, Field, PrimaryButton, Section } from '../../components/form';
import { useSettings } from '../../state/settings';

const isWsUrl = (v: string) => /^wss?:\/\/[^\s/]+/i.test(v);

/**
 * The rendezvous points. Edited as a draft and saved together, because every
 * change here redials every path and doing that per keystroke is pointless.
 */
export default function ServersScreen() {
  const s = useSettings();
  const [relay, setRelay] = useState(s.relayUrl ?? '');
  const [mqtt, setMqtt] = useState(s.mqttUrl);
  const [stun, setStun] = useState(s.stunUrls.join(', '));
  const [turnUrl, setTurnUrl] = useState(s.turn?.urls ?? '');
  const [turnUser, setTurnUser] = useState(s.turn?.username ?? '');
  const [turnPass, setTurnPass] = useState(s.turn?.credential ?? '');

  const relayError = relay && !isWsUrl(relay) ? 'Deve iniziare con ws:// o wss://' : null;
  const mqttError = mqtt && !isWsUrl(mqtt) ? 'Serve un endpoint WebSocket (wss://…/mqtt)' : null;

  return (
    <KeyboardSafe>
      <ScrollView contentContainerClassName="gap-6 px-4 pb-12 pt-2" keyboardShouldPersistTaps="handled">
        <Section
          title="Relay"
          footer="Il tuo server services/relay. Porta WebSocket, HTTP di riserva e la segnalazione WebRTC. Non vede mai la chiave: solo l'id della stanza."
        >
          <Field
            label="Indirizzo"
            value={relay}
            onChangeText={setRelay}
            placeholder="wss://relay.esempio.it"
            keyboardType="url"
            error={relayError}
          />
        </Section>

        <Section
          title="MQTT"
          footer="Un broker pubblico va bene perché ogni comando è firmato; può però leggerli. Per la massima riservatezza usa un tuo mosquitto con WebSocket."
        >
          <Field
            label="Broker (WebSocket)"
            value={mqtt}
            onChangeText={setMqtt}
            placeholder={DEFAULT_MQTT_URL}
            keyboardType="url"
            error={mqttError}
          />
        </Section>

        <Section
          title="WebRTC"
          footer="STUN basta sulla maggior parte delle reti. Sulle reti mobili con NAT simmetrico serve un TURN, altrimenti il percorso diretto non si apre e subentra il relay."
        >
          <Field
            label="STUN"
            value={stun}
            onChangeText={setStun}
            placeholder={DEFAULT_STUN_URLS.join(', ')}
            hint="Separati da virgola"
          />
          <Divider />
          <Field label="TURN" value={turnUrl} onChangeText={setTurnUrl} placeholder="turn:turn.esempio.it:3478" />
          <Field label="Utente TURN" value={turnUser} onChangeText={setTurnUser} />
          <Field label="Password TURN" value={turnPass} onChangeText={setTurnPass} secureTextEntry />
        </Section>

        <PrimaryButton
          label="Salva"
          disabled={!!relayError || !!mqttError}
          onPress={() =>
            s.set({
              relayUrl: relay.trim() || null,
              mqttUrl: mqtt.trim() || DEFAULT_MQTT_URL,
              stunUrls: stun
                .split(',')
                .map((u) => u.trim())
                .filter(Boolean),
              turn: turnUrl.trim()
                ? { urls: turnUrl.trim(), username: turnUser, credential: turnPass }
                : null,
            })
          }
        />
      </ScrollView>
    </KeyboardSafe>
  );
}
