import './app/styles.css'
import { createAppShell } from './app/app-shell'

const root = document.querySelector<HTMLElement>('#app')
if (!root) throw new Error('Missing #app')

createAppShell(root)
