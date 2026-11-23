import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  type FaceLivenessCredentials,
  FaceLivenessView,
  requestCameraPermission,
} from "react-native-face-liveness";

type Session = { sessionId: string; region: string; credentials: FaceLivenessCredentials };

const DEFAULT_SERVER = process.env.EXPO_PUBLIC_DEV_SERVER ?? "http://192.168.0.10:8787";

export default function App() {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [session, setSession] = useState<Session | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((lines) => [`${new Date().toLocaleTimeString()} ${line}`, ...lines]);

  async function start() {
    const permission = await requestCameraPermission();
    add(`camera: ${permission}`);
    if (permission !== "granted") return;
    try {
      const started = Date.now();
      const response = await fetch(`${server}/start`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      add(`session ${body.sessionId.slice(0, 8)} in ${Date.now() - started} ms`);
      setSession(body);
    } catch (error) {
      add(`start failed: ${String(error)}`);
    }
  }

  async function finish(sessionId: string) {
    setSession(null);
    const response = await fetch(`${server}/finish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const body = await response.json();
    add(`result: ${JSON.stringify(body)}`);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Face Liveness example</Text>
      <TextInput style={styles.input} value={server} onChangeText={setServer} autoCapitalize="none" />
      <Button title="Start check" onPress={start} />
      <ScrollView style={styles.log}>
        {log.map((line, index) => (
          <Text key={index} style={styles.line}>{line}</Text>
        ))}
      </ScrollView>
      <Modal visible={session !== null} animationType="slide" presentationStyle="fullScreen">
        {session && (
          <FaceLivenessView
            style={StyleSheet.absoluteFill}
            sessionId={session.sessionId}
            region={session.region}
            credentials={session.credentials}
            onComplete={() => {
              add("onComplete");
              finish(session.sessionId);
            }}
            onError={(error) => {
              add(`onError ${error.code}: ${error.message}`);
              setSession(null);
            }}
          />
        )}
      </Modal>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 64, paddingHorizontal: 16, gap: 12, backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  log: { flex: 1 },
  line: { fontSize: 12, fontFamily: "Courier", marginBottom: 6 },
});
