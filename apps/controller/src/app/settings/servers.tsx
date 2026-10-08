import { DEFAULT_MQTT_URL, DEFAULT_STUN_URLS } from '@relay/protocol';
import { useState } from 'react';
import { KeyboardSafe } from '../../components/KeyboardSafe';
import { ScrollView } from 'react-native';
import { Divider, Field, PrimaryButton, Section } from '../../components/form';
import { useT } from '../../lib/i18n';
import { useSettings } from '../../state/settings';

const isWsUrl = (v: string) => /^wss?:\/\/[^\s/]+/i.test(v);

/**
 * The rendezvous points. Edited as a draft and saved together, because every
 * change here redials every path and doing that per keystroke is pointless.
 */
export default function ServersScreen() {
  const t = useT();
  const s = useSettings();
  const [relay, setRelay] = useState(s.relayUrl ?? '');
  const [mqtt, setMqtt] = useState(s.mqttUrl);
  const [stun, setStun] = useState(s.stunUrls.join(', '));
  const [turnUrl, setTurnUrl] = useState(s.turn?.urls ?? '');
  const [turnUser, setTurnUser] = useState(s.turn?.username ?? '');
  const [turnPass, setTurnPass] = useState(s.turn?.credential ?? '');

  const relayError = relay && !isWsUrl(relay) ? t('servers.wsError') : null;
  const mqttError = mqtt && !isWsUrl(mqtt) ? t('servers.mqttError') : null;

  return (
    <KeyboardSafe>
      <ScrollView contentContainerClassName="gap-6 px-4 pb-12 pt-2" keyboardShouldPersistTaps="handled">
        <Section
          title={t('servers.relay')}
          footer={t('servers.relayFooter')}
        >
          <Field
            label={t('servers.address')}
            value={relay}
            onChangeText={setRelay}
            placeholder="wss://relay.esempio.it"
            keyboardType="url"
            error={relayError}
          />
        </Section>

        <Section
          title="MQTT"
          footer={t('servers.mqttFooter')}
        >
          <Field
            label={t('servers.mqttBroker')}
            value={mqtt}
            onChangeText={setMqtt}
            placeholder={DEFAULT_MQTT_URL}
            keyboardType="url"
            error={mqttError}
          />
        </Section>

        <Section
          title={t('servers.webrtc')}
          footer={t('servers.webrtcFooter')}
        >
          <Field
            label={t('servers.stun')}
            value={stun}
            onChangeText={setStun}
            placeholder={DEFAULT_STUN_URLS.join(', ')}
            hint={t('servers.stunHint')}
          />
          <Divider />
          <Field label={t('servers.turn')} value={turnUrl} onChangeText={setTurnUrl} placeholder="turn:turn.esempio.it:3478" />
          <Field label={t('servers.turnUser')} value={turnUser} onChangeText={setTurnUser} />
          <Field label={t('servers.turnPass')} value={turnPass} onChangeText={setTurnPass} secureTextEntry />
        </Section>

        <PrimaryButton
          label={t('common.save')}
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
