# Public test-only TLS identity

tls-test.crt and tls-test.key are a deliberately public, self-signed localhost identity for automated HTTPS verification tests. They contain no deployment credentials. Never install or trust this key/certificate in production. The certificate has a localhost DNS SAN; tests must reject other hostnames and untrusted identities.

Generated with OpenSSL using a fresh RSA-2048 key, SHA-256 signing, a localhost DNS SAN and a 7300-day validity period. Keeping the fixture in the repository lets Linux/Windows tests run without a system OpenSSL dependency.
