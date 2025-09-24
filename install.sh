#!/bin/bash
echo "========================================="
echo " Instalador del controlador estilo UniFi OS"
echo "========================================="

# Actualizar paquetes
sudo apt update && sudo apt upgrade -y

# Instalar Node.js y npm si no están
if ! command -v node &> /dev/null
then
    echo "Node.js no encontrado, instalando..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js ya está instalado. Version: $(node -v)"
fi

# Instalar npm si no existe
if ! command -v npm &> /dev/null
then
    echo "npm no encontrado, instalando..."
    sudo apt install -y npm
else
    echo "npm ya está instalado. Version: $(npm -v)"
fi

# Instalar dependencias del proyecto
echo "Instalando dependencias del proyecto..."
npm install

# Arrancar el servidor
echo "Iniciando el servidor..."
npm start
