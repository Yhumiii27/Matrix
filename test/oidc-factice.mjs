// Fournisseur OpenID Connect factice, à la manière de Microsoft Entra ID (v2.0), pour les tests de la connexion de
// Matrix (E-02). Aucune authentification réelle : le compte « connecté » est choisi par le test (choisir(cle)).
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export async function demarrerFournisseur({ clientId = 'matrix', clientSecret = 'secret-de-test', comptes }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'cle-1', alg: 'RS256', use: 'sig' };
  const codes = new Map();
  let courant = Object.keys(comptes)[0];
  const serveur = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (code, corps) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(corps)); };
    if (url.pathname === '/tenant/v2.0/.well-known/openid-configuration') return json(200, {
      issuer, authorization_endpoint: `${base}/tenant/oauth2/v2.0/authorize`, token_endpoint: `${base}/tenant/oauth2/v2.0/token`,
      jwks_uri: `${base}/tenant/discovery/v2.0/keys`, response_types_supported: ['code'], subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'] });
    if (url.pathname === '/tenant/discovery/v2.0/keys') return json(200, { keys: [jwk] });
    if (url.pathname === '/tenant/oauth2/v2.0/authorize') {
      const q = url.searchParams;
      if (q.get('client_id') !== clientId || q.get('code_challenge_method') !== 'S256') return json(400, { error: 'invalid_request' });
      const compte = comptes[courant];
      const retour = new URL(q.get('redirect_uri'));
      if (compte.nonAffecte) {
        retour.searchParams.set('error', 'access_denied'); retour.searchParams.set('error_description', 'AADSTS50105: utilisateur non affecté à l’application');
      } else {
        const code = randomBytes(16).toString('hex');
        codes.set(code, { compte, nonce: q.get('nonce'), challenge: q.get('code_challenge'), redirect: q.get('redirect_uri') });
        retour.searchParams.set('code', code);
      }
      retour.searchParams.set('state', q.get('state'));
      res.writeHead(302, { location: retour.href }); return res.end();
    }
    if (url.pathname === '/tenant/oauth2/v2.0/token' && req.method === 'POST') {
      let corps = ''; for await (const m of req) corps += m;
      const f = new URLSearchParams(corps);
      const basic = String(req.headers.authorization ?? '').match(/^Basic (.+)$/);
      const [id, secret] = basic ? Buffer.from(basic[1], 'base64').toString().split(':').map(decodeURIComponent) : [f.get('client_id'), f.get('client_secret')];
      if (id !== clientId || secret !== clientSecret) return json(401, { error: 'invalid_client' });
      const c = codes.get(f.get('code')); codes.delete(f.get('code'));
      if (!c || c.redirect !== f.get('redirect_uri')) return json(400, { error: 'invalid_grant' });
      if (createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE' });
      const id_token = await new SignJWT({ name: c.compte.name, oid: c.compte.oid, preferred_username: c.compte.email, roles: c.compte.roles ?? [], nonce: c.nonce, tid: 'tenant' })
        .setProtectedHeader({ alg: 'RS256', kid: 'cle-1' }).setIssuer(issuer).setAudience(clientId).setSubject(c.compte.oid).setIssuedAt().setExpirationTime('10m').sign(privateKey);
      return json(200, { access_token: 'jeton-d-acces', token_type: 'Bearer', expires_in: 600, id_token });
    }
    json(404, { error: 'introuvable' });
  });
  await new Promise(ok => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${serveur.address().port}`;
  const issuer = `${base}/tenant/v2.0`;
  return { issuer, clientId, clientSecret, choisir: cle => { courant = cle; }, fermer: () => new Promise(ok => serveur.close(ok)) };
}
