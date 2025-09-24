#!/usr/bin/env python3
# ap-agent.py
import socket, json, time, subprocess, os, threading

SERVER_IP = "IP_DE_TU_SERVIDOR"  # cambia a la IP del controller
SERVER_PORT = 4000
LISTEN_PORT = 4001  # para recibir órdenes (opcional)

AP_ID = "pi400"
AP_NAME = "This-device"

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(('', 0))  # random outgoing port

def get_clients_count():
    try:
        out = subprocess.check_output("iw dev wlan0 station dump | grep Station | wc -l", shell=True).decode().strip()
        return int(out)
    except:
        return 0

def get_traffic_kb():
    try:
        with open('/proc/net/dev') as f:
            for line in f:
                if 'wlan0' in line:
                    data = line.split()
                    rx = int(data[1]); tx = int(data[9])
                    return (rx + tx) // 1024
    except:
        return 0

def send_telemetry():
    while True:
        payload = {
            "id": AP_ID,
            "name": AP_NAME,
            "clients": get_clients_count(),
            "traffic": get_traffic_kb(),
            "status": "online"
        }
        try:
            sock.sendto(json.dumps(payload).encode(), (SERVER_IP, SERVER_PORT))
        except Exception as e:
            print("UDP send error", e)
        time.sleep(5)

# Listener to receive commands (UDP)
def listen_commands():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(('', LISTEN_PORT))
    while True:
        msg, addr = s.recvfrom(65535)
        try:
            data = json.loads(msg.decode())
            handle_command(data)
        except Exception as e:
            print("cmd parse error", e)

def handle_command(cmd):
    # cmd example: { action: 'apply_config', vlan: 10, ssid: 'MiRed' }
    print("Received command:", cmd)
    if cmd.get('action') == 'apply_config':
        vlan = cmd.get('vlan')
        ssid = cmd.get('ssid')
        # ejemplo: escribir un archivo local con la config (no toca hostapd directamente aquí)
        cfg_path = '/etc/mini-unifi/ap-config.json'
        try:
            os.makedirs(os.path.dirname(cfg_path), exist_ok=True)
            with open(cfg_path, 'w') as f:
                json.dump({'vlan':vlan,'ssid':ssid}, f)
            # si quieres que se aplique automáticamente, aquí ejecuta scripts que reconfiguren hostapd/dnsmasq
            # ejemplo (peligroso): subprocess.run(['sudo','systemctl','restart','hostapd'])
            print("Saved config to", cfg_path)
        except Exception as e:
            print("Error saving config", e)

if __name__ == '__main__':
    threading.Thread(target=listen_commands, daemon=True).start()
    send_telemetry()
