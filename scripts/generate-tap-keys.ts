/**
 * Generates an Ed25519 keypair for the TAP-style agent signing demo.
 *
 * Prints the two env values. Nothing is written to disk and the private key is
 * never committed — paste it into .env.local yourself.
 */
import { generateTapKeyPair } from '../packages/visa/src/tap'

const { privateKeyBase64, publicKeyBase64 } = generateTapKeyPair()

console.log('')
console.log('Ed25519 keypair for TAP-style agent signing.')
console.log('Add these to .env.local. The private key is a secret — never commit it.')
console.log('')
console.log(`TAP_PRIVATE_KEY=${privateKeyBase64}`)
console.log(`TAP_PUBLIC_KEY=${publicKeyBase64}`)
console.log('TAP_KEY_ID=customer-agent-01')
console.log('')
console.log('Note: this key is locally generated. It is not registered with Visa and')
console.log('confers no Visa-recognised agent identity.')
console.log('')
