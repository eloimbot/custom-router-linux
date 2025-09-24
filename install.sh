#!/bin/bash
# ========================================================
# Install script completo para custom-router-linux
# ========================================================

# Variables
REPO_URL="https://github.com/eloimbot/custom-router-linux.git"
DIR="$HOME/custom-router-linux"

echo "=== Instalación de Custom Router Linux ==="

# Actualizar repositorios y paquetes
echo "Actualizando sistema..."
sudo apt update -y
sudo apt upgrade -y

# Instalar dependencias básicas
echo "Instalando git y curl..."
sudo apt install -y git curl build-essential

# Instalar Node.js y npm si no existen
if ! command -v node >/dev/null 2>&1; then
    echo "Instalando Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js ya está instalado"
fi

# Clonar el repositorio si no existe
if [ ! -d "$DIR" ]; then
    echo "Clonando repositorio en $DIR..."
    git clone $REPO_URL "$DIR"
else
    echo "Repositorio ya existe en $DIR, actualizando..."
    cd "$DIR"
    git pull
fi

cd "$DIR"

# Instalar dependencias de Node.js
if [ -f package.json ]; then
    echo "Instalando dependencias del proyecto..."
    npm install
else
    echo "No se encontró package.json, omitiendo npm install"
fi

# Arrancar el servidor
if [ -f package.json ]; then
    echo "Iniciando servidor..."
    npm start &
    echo "Servidor iniciado en segundo plano"
fi

echo "=== Instalación completa ==="
