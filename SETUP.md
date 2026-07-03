# Lote Premiado - Guia de Deploy

## Credenciais já configuradas

O projeto já está configurado com suas credenciais:
- **Firebase Project:** sorteio-705ff
- **Mercado Pago Access Token:** configurado no backend
- **Mercado Pago Public Key:** configurado no frontend

---

## 1. Configurar Admin no Firestore

Após o primeiro login com `ssantosmattheuss@gmail.com`, acesse o **Firebase Console > Firestore** e atualize o documento do usuário:

**Collection:** `users` > **Document:** `{UID_DO_USUARIO}`

Adicione/atualize o campo:
```json
{
  "role": "admin"
}
```

Para encontrar o UID, vá em **Firebase Console > Authentication > Users**.

---

## 2. Deploy das Cloud Functions

```bash
# Instalar Firebase CLI (se ainda não tiver)
npm install -g firebase-tools

# Login
firebase login

# Na pasta raiz do projeto
cd lote-premiado

# Instalar dependências das functions
cd functions
npm install
cd ..

# Deploy das functions
firebase deploy --only functions --project sorteio-705ff
```

### Configurar variáveis de ambiente (opcional, já tem fallback no código):
```bash
firebase functions:config:set mercadopago.access_token="APP_USR-6881189590797748-070120-e87aac5da43e0772b985ce3c7a2441d0-713345368" --project sorteio-705ff
```

---

## 3. Configurar Webhook do Mercado Pago

1. Acesse https://www.mercadopago.com.br/developers/panel/app
2. Na sua aplicação > **Webhooks**
3. URL: `https://us-central1-sorteio-705ff.cloudfunctions.net/webhookMercadoPago`
4. Eventos: marque `payment`

---

## 4. Deploy do Frontend

### Opção A: Firebase Hosting
```bash
firebase deploy --only hosting --project sorteio-705ff
```

### Opção B: GitHub Pages
1. Crie um repositório no GitHub
2. Faça push APENAS da pasta `frontend/` como raiz do repositório
3. Settings > Pages > Source: "Deploy from a branch" > Branch: main, folder: / (root)
4. Aguarde o deploy

---

## 5. Deploy das Regras (já configuradas temporariamente abertas até 02/08/2026)

Para usar regras mais seguras em produção:
```bash
firebase deploy --only firestore:rules --project sorteio-705ff
firebase deploy --only firestore:indexes --project sorteio-705ff
```

---

## Estrutura do Projeto

```
lote-premiado/
├── firebase.json
├── firestore.rules
├── firestore.indexes.json
├── frontend/               ← Deploy como site (GitHub Pages ou Firebase Hosting)
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── css/
│   ├── js/
│   ├── user/
│   └── admin/
└── functions/              ← Deploy via firebase deploy --only functions
    ├── package.json
    ├── index.js
    ├── mercadopago.js
    └── utils.js
```

---

## Fluxo de Uso

1. **Admin** faz login com `ssantosmattheuss@gmail.com`
2. Acessa `/admin/index.html`
3. Cria um lote informando: nome do prêmio, imagem, custo, quantidade de números
4. Sistema calcula automaticamente: Meta = Custo × 2, Valor/número = Meta ÷ Quantidade
5. Sistema gera números aleatórios de 6 dígitos (não sequenciais)
6. **Usuários** se cadastram e compram números (manual ou aleatório)
7. Pagamento via PIX (Mercado Pago) com 10 min de reserva
8. Após pagamento confirmado, números vinculados ao usuário
9. Quando 100% vendido, admin realiza o sorteio
10. Vencedor notificado automaticamente

---

## Notas Importantes

- Números são **6 dígitos aleatórios** (ex: 482916, 730251) — NÃO sequenciais
- Usuário pode **combinar** seleção manual + aleatória
- Sorteio **SÓ acontece** com 100% dos números vendidos
- Reserva expira em **10 minutos** — números voltam para venda automaticamente
- O usuário NÃO vê: custo do prêmio, meta, lucro, dados financeiros
