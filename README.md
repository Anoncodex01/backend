# WhapVibez Backend

A high-performance VPS backend that serves as an API Gateway, caching layer, and real-time interaction hub for the WhapVibez Flutter app.

## Architecture

```
Flutter App → VPS API Gateway → (Supabase / Firebase / Agora / Cloudflare)
```

### Key Benefits

- ⚡ **Redis Caching**: Feed loads in milliseconds
- 🔄 **Centralized API**: Fewer client-side requests
- 💨 **WebSocket Gateway**: Real-time live interactions
- 🔐 **Firebase Auth Bridge**: Fixes Firestore permission issues
- 📊 **Background Workers**: Notifications, analytics, moderation

## Stack

- **Runtime**: Node.js 20 + NestJS 10
- **Cache**: Redis 7
- **Proxy**: Nginx
- **Container**: Docker + Docker Compose

## Quick Start

### Local Development

```bash
# Install dependencies
npm install

# Start Redis (requires Docker)
docker run -d -p 6379:6379 redis:7-alpine

# Create .env file
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run start:dev
```

### Production Deployment

1. **Setup VPS** (run on fresh Ubuntu 22.04):
   ```bash
   chmod +x scripts/setup-vps.sh
   ./scripts/setup-vps.sh
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   vim .env  # Add your secrets
   ```

3. **Get SSL certificate**:
   ```bash
   certbot certonly --standalone -d api.whapvibez.com
   ```

4. **Deploy**:
   ```bash
   docker-compose up -d
   ```

## API Endpoints

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/auth/firebase-token` | POST | Get Firebase custom token (fixes Firestore permission) |
| `/v1/auth/me` | GET | Get current user profile |
| `/v1/auth/fcm-token` | POST | Store FCM push token |
| `/v1/auth/logout` | POST | Clear session and FCM token |

### Feed (with caching)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/feed?tab=foryou` | GET | Get For You feed |
| `/v1/feed?tab=following` | GET | Get Following feed |
| `/v1/feed?tab=trending` | GET | Get Trending feed |
| `/v1/feed/posts/:id` | GET | Get single post |
| `/v1/feed/posts/:id/view` | POST | Record view |

### Live Streaming

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/live` | GET | Get active live sessions |
| `/v1/live/start` | POST | Start live session |
| `/v1/live/:id/join` | POST | Join as viewer |
| `/v1/live/:id/leave` | POST | Leave session |
| `/v1/live/:id/end` | POST | End session (host) |
| `/v1/live/:id/state` | GET | Get viewer/heart counts |
| `/v1/live/:id/heart` | POST | Send heart |

### Shop

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/shop/products` | GET | Get products |
| `/v1/shop/products/:id` | GET | Get single product |
| `/v1/shop/categories` | GET | Get categories |

### Analytics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/analytics/me` | GET | Get my analytics |
| `/v1/analytics/user/:id` | GET | Get user analytics |
| `/v1/analytics/post/:id` | GET | Get post analytics |
| `/v1/analytics/platform` | GET | Get platform stats |

## WebSocket Events

Connect to `/socket` with Supabase JWT in auth.

### Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join_live` | → Server | Join live room |
| `leave_live` | → Server | Leave live room |
| `heart` | → Server | Send heart (rate limited) |
| `comment` | → Server | Send comment |
| `viewer_update` | ← Server | Viewer count changed |
| `heart_received` | ← Server | Heart animation |
| `comment_received` | ← Server | New comment |
| `live_ended` | ← Server | Session ended |
| `typing` | ↔ Both | Typing indicator |

## Environment Variables

```bash
# Server
NODE_ENV=production
PORT=3000
API_PREFIX=v1

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Firebase Admin (for custom token minting)
FIREBASE_PROJECT_ID=your-firebase-project
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@...

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Agora
AGORA_APP_ID=your-agora-app-id
AGORA_APP_CERTIFICATE=your-agora-certificate

# Cache TTL (seconds)
CACHE_FEED_TTL=30
CACHE_PROFILE_TTL=60
CACHE_TRENDING_TTL=120

# SMTP Email Configuration
SMTP_HOST=server313.web-hosting.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@whapvibez.com
SMTP_PASSWORD=Noreply@2025
SMTP_FROM_EMAIL=no-reply@whapvibez.com
SMTP_FROM_NAME=WhapVibez
```

## Fixing Firestore Permission-Denied

The VPS solves the Firestore `permission-denied` error by:

1. Flutter authenticates with Supabase
2. Flutter calls `POST /v1/auth/firebase-token` with Supabase JWT
3. VPS verifies Supabase JWT
4. VPS mints Firebase Custom Token using Firebase Admin SDK
5. Flutter signs into Firebase Auth with custom token
6. Now `request.auth.uid` is set in Firestore rules

### Flutter Integration

```dart
// After Supabase login:
final response = await http.post(
  Uri.parse('https://api.whapvibez.com/v1/auth/firebase-token'),
  headers: {'Authorization': 'Bearer $supabaseToken'},
);

final firebaseToken = jsonDecode(response.body)['data']['firebaseToken'];
await FirebaseAuth.instance.signInWithCustomToken(firebaseToken);
```

## Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Restart API
docker-compose restart api

# Rebuild and deploy
docker-compose up -d --build

# Check status
docker-compose ps
```

## Monitoring

- **Health check**: `GET /health`
- **Logs**: `docker-compose logs -f api`
- **Redis monitor**: `docker exec -it whapvibez-redis redis-cli monitor`

## Security

- All endpoints require HTTPS
- Rate limiting via Nginx and Redis
- JWT verification on protected routes
- Fail2ban for SSH protection
- UFW firewall configured

## License

Proprietary - WhapVibez

