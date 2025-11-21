#!/bin/bash

# Helper script to run Shopify dev with ngrok tunnel
# This avoids the Cloudflare tunnel issues

set -e

echo "🚀 Starting ngrok tunnel on port 3000..."

# Kill any existing ngrok processes
pkill -f "ngrok http" || true

# Start ngrok in the background
ngrok http 3000 --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

echo "⏳ Waiting for ngrok to start..."
sleep 3

# Get the ngrok URL
NGROK_URL=""
for i in {1..10}; do
  # Try to get URL from ngrok API
  NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o 'https://[^"]*\.ngrok-free\.app' | head -1 || true)

  if [ -n "$NGROK_URL" ]; then
    break
  fi

  echo "  Attempt $i/10..."
  sleep 1
done

if [ -z "$NGROK_URL" ]; then
  echo "❌ Failed to get ngrok URL"
  echo "📋 Check ngrok logs at /tmp/ngrok.log"
  kill $NGROK_PID 2>/dev/null || true
  exit 1
fi

echo "✅ ngrok tunnel started: $NGROK_URL"
echo ""
echo "🏗️  Starting Shopify dev with tunnel URL..."
echo ""

# Cleanup function to kill ngrok on exit
cleanup() {
  echo ""
  echo "🛑 Stopping ngrok..."
  kill $NGROK_PID 2>/dev/null || true
  exit 0
}

# Set trap to cleanup on script exit
trap cleanup INT TERM EXIT

# Run shopify dev with the tunnel URL
npm run dev -- --tunnel-url "${NGROK_URL}:3000"