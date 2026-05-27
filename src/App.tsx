import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import * as XLSX from 'xlsx'


type DeviceRecord = {
  id: number
  companyName: string
  thirdPartyResponsible?: string | null
  teamLeader: string
  notebookResponsibleName: string
  contactPhone: string
  department: string
  matriculaPlanta: string
  responsiblePhotoPath: string
  assetCode: string
  status: 'LIBERADO' | 'BLOQUEADO'
  createdAt: string
  updatedAt: string
}

type ValidationResponse = {
  device: DeviceRecord
  validationPhotoPath?: string
}

type LiveValidation = {
  validatedAt: string
  device: Omit<DeviceRecord, 'contactPhone'>
  validationPhotoPath?: string
}

type ScreenView = 'cadastro' | 'camera' | 'painel'
type CadastroMenu = 'cadastro' | 'registros' | 'historicos'
type AuthSession = {
  username: string
  signedAt: string
}

type DeviceStatus = DeviceRecord['status']

type DeviceEditForm = {
  companyName: string
  thirdPartyResponsible: string
  teamLeader: string
  notebookResponsibleName: string
  contactPhone: string
  department: string
  matriculaPlanta: string
  status: DeviceStatus
}

const AUTH_STORAGE_KEY = 'asset-control-session'
const INITIAL_EDIT_FORM: DeviceEditForm = {
  companyName: '',
  thirdPartyResponsible: '',
  teamLeader: '',
  notebookResponsibleName: '',
  contactPhone: '',
  department: '',
  matriculaPlanta: '',
  status: 'LIBERADO',
}

const getForcedView = (): ScreenView | null => {
  const raw = (import.meta.env.VITE_APP_VIEW as string | undefined)?.trim()?.toLowerCase()
  if (raw === 'cadastro' || raw === 'camera' || raw === 'painel') {
    return raw
  }
  return null
}

const forcedView = getForcedView()

const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '')
  .trim()
  .replace(/\/+$/, '')

const resolveApiUrl = (resourcePath: string) => {
  if (!resourcePath) {
    return resourcePath
  }

  if (/^(?:https?:)?\/\//.test(resourcePath) || resourcePath.startsWith('data:') || resourcePath.startsWith('blob:')) {
    return resourcePath
  }

  const normalizedPath = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`
  return apiBaseUrl ? `${apiBaseUrl}${normalizedPath}` : normalizedPath
}



const getInitialView = (): ScreenView => {
  if (forcedView) {
    return forcedView
  }
  if (typeof window === 'undefined') {
    return 'cadastro'
  }
  const value = new URLSearchParams(window.location.search).get('view')
  if (value === 'camera') {
    return 'camera'
  }
  if (value === 'painel') {
    return 'painel'
  }
  return 'cadastro'
}

const getInitialSession = (): AuthSession | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed.username || !parsed.signedAt) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

const toMinutes = (timeValue: string) => {
  if (!timeValue) {
    return null
  }
  const [hoursStr, minutesStr] = timeValue.split(':')
  const hours = Number(hoursStr)
  const minutes = Number(minutesStr)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null
  }
  return hours * 60 + minutes
}

const matchDateTimeFilter = (
  sourceDate: Date,
  dateFrom: string,
  dateTo: string,
  timeFrom: string,
  timeTo: string,
) => {
  if (Number.isNaN(sourceDate.getTime())) {
    return false
  }

  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`)
    if (sourceDate < from) {
      return false
    }
  }

  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999`)
    if (sourceDate > to) {
      return false
    }
  }

  const currentMinutes = sourceDate.getHours() * 60 + sourceDate.getMinutes()
  const fromMinutes = toMinutes(timeFrom)
  const toMinutesValue = toMinutes(timeTo)

  if (fromMinutes !== null && currentMinutes < fromMinutes) {
    return false
  }
  if (toMinutesValue !== null && currentMinutes > toMinutesValue) {
    return false
  }

  return true
}

const getStatusMeta = (status: DeviceStatus | string) => {
  const isAuthorized = status === 'LIBERADO'
  return {
    isAuthorized,
    label: isAuthorized ? 'AUTORIZADO' : 'NÃO AUTORIZADO',
    badgeClass: isAuthorized ? 'badge-ok' : 'badge-blocked',
    bannerClass: isAuthorized ? 'status-banner-ok' : 'status-banner-blocked',
    cardClass: isAuthorized ? 'status-ok' : 'status-blocked',
    historyClass: isAuthorized ? 'authorized' : 'blocked',
  }
}

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

const matchText = (source: string, search: string) => {
  if (!search.trim()) {
    return true
  }
  return normalizeSearch(source).includes(normalizeSearch(search))
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(getInitialSession)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState<string | null>(null)
  const [view, setView] = useState<ScreenView>(getInitialView)
  const [cadastroMenu, setCadastroMenu] = useState<CadastroMenu>('cadastro')
  const [cadastroLoading, setCadastroLoading] = useState(false)
  const [cadastroError, setCadastroError] = useState<string | null>(null)
  const [cadastroSuccess, setCadastroSuccess] = useState<DeviceRecord | null>(null)
  const [devices, setDevices] = useState<DeviceRecord[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [recordsDateFrom, setRecordsDateFrom] = useState('')
  const [recordsDateTo, setRecordsDateTo] = useState('')
  const [recordsTimeFrom, setRecordsTimeFrom] = useState('')
  const [recordsTimeTo, setRecordsTimeTo] = useState('')
  const [recordsNameFilter, setRecordsNameFilter] = useState('')
  const [recordsTNumberFilter, setRecordsTNumberFilter] = useState('')
  const [recordStatusFilter, setRecordStatusFilter] = useState<'TODOS' | 'LIBERADO' | 'BLOQUEADO'>('TODOS')
  const [recordsActionLoading, setRecordsActionLoading] = useState(false)
  const [recordsActionError, setRecordsActionError] = useState<string | null>(null)
  const [editingDeviceId, setEditingDeviceId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<DeviceEditForm>(INITIAL_EDIT_FORM)
  const [validationLogs, setValidationLogs] = useState<LiveValidation[]>([])
  const [validationLogsLoading, setValidationLogsLoading] = useState(false)
  const [validationLogsError, setValidationLogsError] = useState<string | null>(null)
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [historyTimeFrom, setHistoryTimeFrom] = useState('')
  const [historyTimeTo, setHistoryTimeTo] = useState('')
  const [historyNameFilter, setHistoryNameFilter] = useState('')
  const [historyTNumberFilter, setHistoryTNumberFilter] = useState('')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'TODOS' | 'LIBERADO' | 'BLOQUEADO'>('TODOS')

  const [qrInput, setQrInput] = useState('')
    const [validationLoading, setValidationLoading] = useState(false)
    const [validationResult, setValidationResult] = useState<LiveValidation | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerError, setScannerError] = useState<string | null>(null)
  const [painelCameras, setPainelCameras] = useState<({id: string; label: string} | null)[]>([null, null, null])
  const [painelResults, setPainelResults] = useState<(LiveValidation | null)[]>([null, null, null])
  const [painelErrors, setPainelErrors] = useState<(string | null)[]>([null, null, null])
  const [painelScanning, setPainelScanning] = useState(false)
  const PAINEL_COUNT = 3
  const scannerRef = useRef<HTMLDivElement | null>(null)
  const lastValidationKeyRef = useRef('')
  const painelScannerRefs = useRef<(HTMLDivElement | null)[]>([null, null, null])
  const painelScannerInstances = useRef<any[]>([null, null, null])

  const configuredAccessUser = (import.meta.env.VITE_ACCESS_USER as string | undefined)?.trim() || 'admin'
  const configuredAccessPassword =
    (import.meta.env.VITE_ACCESS_PASSWORD as string | undefined)?.trim() || 'admin123'

  const handleLoginSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoginError(null)

    const normalizedUser = loginUsername.trim()
    if (!normalizedUser || !loginPassword) {
      setLoginError('Informe usuario e senha para acessar o sistema.')
      return
    }

    const canAccess =
      normalizedUser.toLowerCase() === configuredAccessUser.toLowerCase() &&
      loginPassword === configuredAccessPassword

    if (!canAccess) {
      setLoginError('Credenciais invalidas. Verifique usuario e senha.')
      return
    }

    const nextSession: AuthSession = {
      username: normalizedUser,
      signedAt: new Date().toISOString(),
    }
    setSession(nextSession)
    setLoginPassword('')
    setLoginError(null)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession))
    }
  }

  const handleLogout = () => {
    setSession(null)
    setLoginPassword('')
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(AUTH_STORAGE_KEY)
    }
  }

  const lockedView = forcedView
  const isUnifiedMode = !lockedView
  const canUseEmbeddedCamera =
    typeof window !== 'undefined' && (window.isSecureContext || window.location.hostname === 'localhost')

  useEffect(() => {
    if (view !== 'camera' || !canUseEmbeddedCamera || !scannerOpen || !scannerRef.current) {
      return
    }

    let mounted = true
    let scannerCleanup: (() => Promise<void>) | null = null

    const startScanner = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        const scanner = new Html5Qrcode('barcode-reader', {
          verbose: false,
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.DATA_MATRIX,
            Html5QrcodeSupportedFormats.AZTEC,
            Html5QrcodeSupportedFormats.PDF_417,
          ],
        })
        scannerCleanup = async () => {
          if (scanner.isScanning) {
            await scanner.stop()
          }
          await scanner.clear()
        }

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 18,
          },
          async (decodedText) => {
            if (!mounted) {
              return
            }
            lastValidationKeyRef.current = ''
            setScannerError(null)
            setQrInput(decodedText)
          },
          () => {
            // Ignore frame decode errors while scanning.
          },
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Falha ao iniciar a camera no navegador atual.'
        if (mounted) {
          setScannerError(
            `${message} A leitura continua so funciona em HTTPS ou localhost no proprio aparelho.`,
          )
          setScannerOpen(false)
        }
      }
    }

    void startScanner()

    return () => {
      mounted = false
      if (scannerCleanup) {
        void scannerCleanup()
      }
    }
  }, [canUseEmbeddedCamera, scannerOpen, view])

  useEffect(() => {
    if (view === 'camera' && canUseEmbeddedCamera) {
      setScannerOpen(true)
    }
  }, [canUseEmbeddedCamera, view])

  const runValidation = useCallback(async (assetCode: string, photo: File | null) => {
    setValidationLoading(true)

    try {
      const formData = new FormData()
      formData.set('assetCode', assetCode)
      if (photo) {
        formData.set('assetPhoto', photo)
      }

      const response = await fetch(resolveApiUrl('/api/validate'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Falha na validacao')
      }

      const payload = (await response.json()) as ValidationResponse
      setValidationResult({
        validatedAt: new Date().toISOString(),
        device: {
          id: payload.device.id,
          companyName: payload.device.companyName,
          thirdPartyResponsible: payload.device.thirdPartyResponsible ?? null,
          teamLeader: payload.device.teamLeader,
          notebookResponsibleName: payload.device.notebookResponsibleName,
          department: payload.device.department,
          matriculaPlanta: payload.device.matriculaPlanta,
          responsiblePhotoPath: payload.device.responsiblePhotoPath,
          assetCode: payload.device.assetCode,
          status: payload.device.status,
          createdAt: payload.device.createdAt,
          updatedAt: payload.device.updatedAt,
        },
        validationPhotoPath: payload.validationPhotoPath,
      })
    } catch (error) {
      lastValidationKeyRef.current = ''
    } finally {
      setValidationLoading(false)
    }
  }, [])

  useEffect(() => {
    if (view !== 'camera' || !qrInput || validationLoading) {
      return
    }

    const validationKey = qrInput;
    if (lastValidationKeyRef.current === validationKey) return;
    lastValidationKeyRef.current = validationKey;
    void runValidation(qrInput, null);
  }, [qrInput, runValidation, validationLoading, view])



  const validatePainel = useCallback(async (index: number, assetCode: string) => {
    try {
      const formData = new FormData()
      formData.set('assetCode', assetCode)

      const response = await fetch(resolveApiUrl('/api/validate'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Falha na validacao')
      }

      const payload = (await response.json()) as ValidationResponse
      const validation: LiveValidation = {
        validatedAt: new Date().toISOString(),
        device: {
          id: payload.device.id,
          companyName: payload.device.companyName,
          thirdPartyResponsible: payload.device.thirdPartyResponsible ?? null,
          teamLeader: payload.device.teamLeader,
          notebookResponsibleName: payload.device.notebookResponsibleName,
          department: payload.device.department,
          matriculaPlanta: payload.device.matriculaPlanta,
          responsiblePhotoPath: payload.device.responsiblePhotoPath,
          assetCode: payload.device.assetCode,
          status: payload.device.status,
          createdAt: payload.device.createdAt,
          updatedAt: payload.device.updatedAt,
        },
        validationPhotoPath: payload.validationPhotoPath,
      }

      setPainelResults(prev => {
        const next = [...prev]
        next[index] = validation
        return next
      })
    } catch (error) {
      setPainelErrors(prev => {
        const next = [...prev]
        next[index] = error instanceof Error ? error.message : 'Erro na validacao'
        return next
      })
    }
  }, [])




  // --- 3-camera painel scanner ---
  useEffect(() => {
    if (view !== 'painel') {
      return
    }

    setPainelResults([null, null, null])
    setPainelErrors([null, null, null])
    setPainelScanning(false)

    let mounted = true

    const setupCameras = async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode')
        const cameras = await Html5Qrcode.getCameras()
        if (!mounted) return

        const scanFormats = [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.AZTEC,
          Html5QrcodeSupportedFormats.PDF_417,
        ]

        // Prefer rear/back cameras (front camera often comes first on mobile)
        const sorted = [...cameras].sort((a, b) => {
          const rear = /back|rear|environment|traseira|ambient/i
          const aIsRear = rear.test(a.label) ? 0 : 1
          const bIsRear = rear.test(b.label) ? 0 : 1
          return aIsRear - bIsRear
        })

        const assigned: ({id: string; label: string} | null)[] = [
          sorted[0] ?? null,
          sorted[1] ?? null,
          sorted[2] ?? null,
        ]
        setPainelCameras(assigned)

        setPainelScanning(true)

        for (let index = 0; index < PAINEL_COUNT; index++) {
          const cam = assigned[index]
          if (!cam) {
            setPainelErrors(prev => {
              const next = [...prev]
              next[index] = cameras.length === 0 ? 'Nenhuma camera detectada' : 'Apenas ' + cameras.length + ' camera(s) encontrada(s)'
              return next
            })
            continue
          }

          // Small delay between starts to avoid browser stream limits
          if (index > 0) await new Promise(r => setTimeout(r, 500))

          try {
            const scanner = new Html5Qrcode('painel-reader-' + index, { verbose: false, formatsToSupport: scanFormats })
            painelScannerInstances.current[index] = scanner

            await scanner.start(
              { deviceId: { exact: cam.id } },
              { fps: 18 },
              async (decodedText) => {
                if (!mounted) return
                await validatePainel(index, decodedText)
              },
              () => {},
            )
          } catch {
            if (!mounted) return
            // If exact deviceId fails, try facingMode fallback for rear cameras
            const rear = /back|rear|environment|traseira|ambient/i
            if (rear.test(cam.label)) {
              try {
                const scanner = new Html5Qrcode('painel-reader-' + index, { verbose: false, formatsToSupport: scanFormats })
                painelScannerInstances.current[index] = scanner
                await scanner.start(
                  { facingMode: 'environment' },
                  { fps: 18 },
                  async (decodedText) => {
                    if (!mounted) return
                    await validatePainel(index, decodedText)
                  },
                  () => {},
                )
                continue // success with fallback, skip to next index
              } catch {
                // fallback also failed, show error below
              }
            }
            setPainelErrors(prev => {
              const next = [...prev]
              next[index] = 'Falha ao iniciar camera ' + (index + 1)
              return next
            })
          }
        }
      } catch {
        if (!mounted) return
        for (let i = 0; i < PAINEL_COUNT; i++) {
          setPainelErrors(prev => {
            const next = [...prev]
            next[i] = 'Erro ao acessar cameras. Verifique permissoes e HTTPS.'
            return next
          })
        }
      }
    }

    void setupCameras()

    return () => {
      mounted = false
      for (let i = 0; i < PAINEL_COUNT; i++) {
        const scanner = painelScannerInstances.current[i]
        if (scanner) {
          if (scanner.isScanning) { void scanner.stop() }
          scanner.clear()
        }
      }
      painelScannerInstances.current = [null, null, null]
    }
  }, [view, validatePainel])

  const validateNotAbbreviated = (value: string, fieldLabel: string): string | null => {
    const trimmed = value.trim()
    if (trimmed.length <= 3 && /^[A-Za-z]+$/.test(trimmed)) {
      return `${fieldLabel} nao pode ser uma sigla abreviada (ex: "${trimmed}"). Informe o nome completo.`
    }
    return null
  }

  const handleCadastroSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setCadastroError(null)
    setCadastroSuccess(null)

    const formData = new FormData(event.currentTarget)

    const textFields = ['companyName', 'thirdPartyResponsible', 'teamLeader', 'notebookResponsibleName', 'department', 'matriculaPlanta', 'assetCode'] as const
    for (const field of textFields) {
      const val = formData.get(field) as string | null
      if (val) {
        formData.set(field, val.toUpperCase().trim())
      }
    }

    const companyName = (formData.get('companyName') as string | null)?.trim() || ''
    const notebookName = (formData.get('notebookResponsibleName') as string | null)?.trim() || ''
    const matriculaPlanta = (formData.get('matriculaPlanta') as string | null)?.trim() || ''
    const assetCode = (formData.get('assetCode') as string | null)?.trim() || ''
    const photoFile = formData.get('responsiblePhoto') as File | null

    if (!companyName) {
      setCadastroError('Preencha o campo obrigatorio: Nome da empresa.')
      return
    }
    if (!notebookName) {
      setCadastroError('Preencha o campo obrigatorio: Nome do responsavel pelo notebook.')
      return
    }
    if (!matriculaPlanta) {
      setCadastroError('Preencha o campo obrigatorio: T-number (matricula/planta).')
      return
    }
    if (!assetCode) {
      setCadastroError('Preencha o campo obrigatorio: Ativo do dispositivo.')
      return
    }
    if (!photoFile || photoFile.size === 0) {
      setCadastroError('Anexe a foto do responsavel do dispositivo.')
      return
    }

    const abbrError = validateNotAbbreviated(companyName, 'Nome da empresa')
    if (abbrError) {
      setCadastroError(abbrError)
      return
    }

    setCadastroLoading(true)
    try {
      const response = await fetch(resolveApiUrl('/api/devices'), {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Erro no cadastro')
      }

      const payload = (await response.json()) as DeviceRecord
      setCadastroSuccess(payload)
      event.currentTarget?.reset()
    } catch (error) {
      setCadastroError(error instanceof Error ? error.message : 'Erro inesperado no cadastro')
    } finally {
      setCadastroLoading(false)
    }
  }

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true)
    setDevicesError(null)
    try {
      const response = await fetch(resolveApiUrl('/api/devices'), { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Falha ao carregar registros de cadastro')
      }
      const payload = (await response.json()) as DeviceRecord[]
      setDevices(payload)
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : 'Erro ao carregar registros')
    } finally {
      setDevicesLoading(false)
    }
  }, [])




  const loadValidationLogs = useCallback(async () => {
    setValidationLogsLoading(true)
    setValidationLogsError(null)
    try {
      const response = await fetch(resolveApiUrl('/api/validation/logs'), { cache: 'no-store' })
      if (!response.ok) {
        throw new Error('Falha ao carregar historico de logs')
      }
      const payload = (await response.json()) as { logs: LiveValidation[] }
      setValidationLogs(payload.logs)
    } catch (error) {
      setValidationLogsError(error instanceof Error ? error.message : 'Erro ao carregar historico')
    } finally {
      setValidationLogsLoading(false)
    }
  }, [])









  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (lockedView) {
      return
    }
    const params = new URLSearchParams(window.location.search)
    params.set('view', view)
    const nextQuery = params.toString()
    const nextUrl = `${window.location.pathname}?${nextQuery}`
    window.history.replaceState(null, '', nextUrl)
  }, [lockedView, view])

  useEffect(() => {
    if (view !== 'cadastro') {
      return
    }
    if (cadastroMenu === 'registros') {
      void loadDevices()
    }
    if (cadastroMenu === 'historicos') {
      void loadValidationLogs()
    }
  }, [cadastroMenu, loadDevices, loadValidationLogs, view])

  const headerTitle =
    view === 'cadastro'
      ? 'Cadastro de notebooks'
      : view === 'camera'
        ? 'Leitor'
        : 'Painel de resultado'

  const filteredDevices = useMemo(() => {
    return devices.filter((device) => {
      const byDateTime = matchDateTimeFilter(
        new Date(device.createdAt),
        recordsDateFrom,
        recordsDateTo,
        recordsTimeFrom,
        recordsTimeTo,
      )
      if (!byDateTime) {
        return false
      }
      if (recordStatusFilter === 'TODOS') {
        const byName =
          matchText(device.notebookResponsibleName, recordsNameFilter) ||
          matchText(device.teamLeader, recordsNameFilter) ||
          matchText(device.companyName, recordsNameFilter) ||
          matchText(device.thirdPartyResponsible ?? '', recordsNameFilter)
        const byTNumber = matchText(device.matriculaPlanta, recordsTNumberFilter)
        return byName && byTNumber
      }
      const byStatus = device.status === recordStatusFilter
      const byName =
        matchText(device.notebookResponsibleName, recordsNameFilter) ||
        matchText(device.teamLeader, recordsNameFilter) ||
        matchText(device.companyName, recordsNameFilter) ||
        matchText(device.thirdPartyResponsible ?? '', recordsNameFilter)
      const byTNumber = matchText(device.matriculaPlanta, recordsTNumberFilter)
      return byStatus && byName && byTNumber
    })
  }, [
    devices,
    recordStatusFilter,
    recordsDateFrom,
    recordsDateTo,
    recordsNameFilter,
    recordsTNumberFilter,
    recordsTimeFrom,
    recordsTimeTo,
  ])

  const filteredValidationLogs = useMemo(() => {
    return validationLogs.filter((entry) => {
      const byDateTime = matchDateTimeFilter(
        new Date(entry.validatedAt),
        historyDateFrom,
        historyDateTo,
        historyTimeFrom,
        historyTimeTo,
      )
      if (!byDateTime) {
        return false
      }
      if (historyStatusFilter === 'TODOS') {
        const byName =
          matchText(entry.device.notebookResponsibleName, historyNameFilter) ||
          matchText(entry.device.teamLeader, historyNameFilter) ||
          matchText(entry.device.companyName, historyNameFilter) ||
          matchText(entry.device.thirdPartyResponsible ?? '', historyNameFilter)
        const byTNumber = matchText(entry.device.matriculaPlanta, historyTNumberFilter)
        return byName && byTNumber
      }
      const byStatus = entry.device.status === historyStatusFilter
      const byName =
        matchText(entry.device.notebookResponsibleName, historyNameFilter) ||
        matchText(entry.device.teamLeader, historyNameFilter) ||
        matchText(entry.device.companyName, historyNameFilter) ||
        matchText(entry.device.thirdPartyResponsible ?? '', historyNameFilter)
      const byTNumber = matchText(entry.device.matriculaPlanta, historyTNumberFilter)
      return byStatus && byName && byTNumber
    })
  }, [
    historyDateFrom,
    historyDateTo,
    historyNameFilter,
    historyStatusFilter,
    historyTNumberFilter,
    historyTimeFrom,
    historyTimeTo,
    validationLogs,
  ])

  const saveEditedDevice = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editingDeviceId) {
      return
    }

    setRecordsActionError(null)

    const companyName = editForm.companyName.trim()
    const notebookName = editForm.notebookResponsibleName.trim()
    const matriculaPlanta = editForm.matriculaPlanta.trim()

    if (!companyName) {
      setRecordsActionError('Preencha o campo obrigatorio: Nome da empresa.')
      return
    }
    if (!notebookName) {
      setRecordsActionError('Preencha o campo obrigatorio: Nome do responsavel pelo notebook.')
      return
    }
    if (!matriculaPlanta) {
      setRecordsActionError('Preencha o campo obrigatorio: T-number.')
      return
    }

    const abbrError = validateNotAbbreviated(companyName, 'Nome da empresa')
    if (abbrError) {
      setRecordsActionError(abbrError)
      return
    }

    setRecordsActionLoading(true)
    try {
      const response = await fetch(resolveApiUrl(`/api/devices/${editingDeviceId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })

      if (!response.ok) {
        const errorData = (await response.json()) as { error?: string }
        throw new Error(errorData.error ?? 'Falha ao editar registro')
      }

      setEditingDeviceId(null)
      setEditForm(INITIAL_EDIT_FORM)
      await loadDevices()
    } catch (error) {
      setRecordsActionError(error instanceof Error ? error.message : 'Erro ao editar registro')
    } finally {
      setRecordsActionLoading(false)
    }
  }

  const downloadPDF = useCallback(() => {
    if (filteredDevices.length === 0) {
      alert('Nao ha registros para exportar no filtro aplicado.')
      return
    }

    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Relatorio de Registros de Cadastro', 14, 15)
    doc.setFontSize(10)
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 25)
    doc.text(`Total filtrado: ${filteredDevices.length}`, 14, 31)

    const tableData = filteredDevices.map((d) => [
      d.assetCode,
      d.companyName,
      d.notebookResponsibleName,
      d.department,
      d.matriculaPlanta,
      d.status === 'LIBERADO' ? 'AUTORIZADO' : 'NÃO AUTORIZADO',
      new Date(d.createdAt).toLocaleString('pt-BR'),
    ])

    autoTable(doc, {
      head: [['Ativo', 'Empresa', 'Responsavel', 'Setor', 'Matricula', 'Status', 'Data/Hora Cadastro']],
      body: tableData,
      startY: 36,
      margin: 10,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
    })

    doc.save(`registros-cadastro-${new Date().toISOString().split('T')[0]}.pdf`)
  }, [filteredDevices])

  const downloadExcel = useCallback(() => {
    if (filteredDevices.length === 0) {
      alert('Nao ha registros para exportar no filtro aplicado.')
      return
    }

    const data = filteredDevices.map((d) => ({
      Ativo: d.assetCode,
      Empresa: d.companyName,
      Responsavel: d.notebookResponsibleName,
      Lider: d.teamLeader,
      Departamento: d.department,
      MatriculaPlanta: d.matriculaPlanta,
      ResponsavelTerceiro: d.thirdPartyResponsible || '-',
      Telefone: d.contactPhone,
      Status: d.status === 'LIBERADO' ? 'AUTORIZADO' : 'NÃO AUTORIZADO',
      DataHoraCadastro: new Date(d.createdAt).toLocaleString('pt-BR'),
    }))

    const ws = XLSX.utils.json_to_sheet(data)
      ws['!cols'] = [
        { wch: 12 },
        { wch: 20 },
        { wch: 20 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 15 },
        { wch: 12 },
        { wch: 15 },
      ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Registros')
    XLSX.writeFile(wb, `registros-cadastro-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [filteredDevices])

  
  
  const downloadHistoryPDF = useCallback(() => {
    if (filteredValidationLogs.length === 0) {
      alert('Nao ha logs para exportar no filtro aplicado.')
      return
    }

    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Relatorio de Historico de Validacoes', 14, 15)
    doc.setFontSize(10)
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 25)
    doc.text(`Total filtrado: ${filteredValidationLogs.length}`, 14, 31)

    const tableData = filteredValidationLogs.map((entry) => [
      new Date(entry.validatedAt).toLocaleString('pt-BR'),
      entry.device.assetCode,
      entry.device.notebookResponsibleName,
      entry.device.companyName,
      entry.device.status === 'LIBERADO' ? 'AUTORIZADO' : 'NAO AUTORIZADO',
    ])

    autoTable(doc, {
      head: [['Data/Hora', 'Ativo', 'Responsavel', 'Empresa', 'Status']],
      body: tableData,
      startY: 36,
      margin: 10,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [2, 132, 199], textColor: [255, 255, 255], fontStyle: 'bold' },
    })

    doc.save(`historico-validacoes-${new Date().toISOString().split('T')[0]}.pdf`)
  }, [filteredValidationLogs])

  const downloadHistoryExcel = useCallback(() => {
    if (filteredValidationLogs.length === 0) {
      alert('Nao ha logs para exportar no filtro aplicado.')
      return
    }

    const data = filteredValidationLogs.map((entry) => ({
      DataHora: new Date(entry.validatedAt).toLocaleString('pt-BR'),
      Ativo: entry.device.assetCode,
      Responsavel: entry.device.notebookResponsibleName,
      Empresa: entry.device.companyName,
      Lider: entry.device.teamLeader,
      Departamento: entry.device.department,
      MatriculaPlanta: entry.device.matriculaPlanta,
      Status: entry.device.status === 'LIBERADO' ? 'AUTORIZADO' : 'NAO AUTORIZADO',
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [
      { wch: 20 },
      { wch: 12 },
      { wch: 24 },
      { wch: 22 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 14 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Historicos')
    XLSX.writeFile(wb, `historico-validacoes-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [filteredValidationLogs])

  
  if (!session && view !== 'camera' && view !== 'painel') {
    return (
      <div className="auth-shell">
        <div className="auth-brand-panel">
          <div className="auth-brand-logo">AC</div>
          <h2 className="auth-brand-title">AssetControl</h2>
          <p className="auth-brand-desc">Sistema corporativo de gestão e controle de ativos empresariais com Código de Barras</p>
          <ul className="auth-feature-list">
            <li>Cadastro seguro com Código de Barras único</li>
            <li>Validação por câmera em tempo real</li>
            <li>Painel de auditoria e histórico</li>
            <li>Exportação em PDF e Excel</li>
          </ul>
        </div>
        <section className="auth-card">
          <p className="auth-kicker">Acesso ao Sistema</p>
          <h1>Bem-vindo</h1>
          <p className="auth-subtitle">
            Informe suas credenciais para continuar.
          </p>

          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <label>
              Usuário
              <input
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                autoComplete="username"
                placeholder="Digite seu usuário"
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </label>

            <button type="submit">Entrar no sistema</button>
          </form>

          <button type="button" className="auth-reader-btn" onClick={() => setView('camera')}>
            Abrir Leitor sem login
          </button>

          {loginError && <p className="error-msg auth-error">{loginError}</p>}
        </section>
      </div>
    )
  }

  return (
    <>
      {view !== 'camera' && (
        <header className="topbar">
          <div className="topbar-brand">
            <div className="brand-logo-mark">AC</div>
            <div className="brand-text">
              <span className="brand-name">AssetControl</span>
              <span className="brand-sub">Gestão de Ativos</span>
            </div>
          </div>

          {isUnifiedMode && (
            <nav className="topbar-nav" role="tablist" aria-label="Etapas">
              <button
                type="button"
                role="tab"
                className={`topnav-item ${view === 'cadastro' ? 'active' : ''}`}
                onClick={() => setView('cadastro')}
              >
                Cadastro
              </button>
              <button
                type="button"
                role="tab"
                className="topnav-item"
                onClick={() => setView('camera')}
              >
                Leitor
              </button>
              <button
                type="button"
                role="tab"
                className={`topnav-item ${view === 'painel' ? 'active' : ''}`}
                onClick={() => setView('painel')}
              >
                Painel
              </button>
            </nav>
          )}
          {!isUnifiedMode && <span className="topbar-screen-title">{headerTitle}</span>}

          {session && (
            <div className="topbar-user">
              <div className="user-chip">
                <span className="user-avatar-dot">{session.username.slice(0, 1).toUpperCase()}</span>
                <span className="user-name">{session.username}</span>
              </div>
              <button type="button" className="btn-logout" onClick={handleLogout}>
                Sair
              </button>
            </div>
          )}
        </header>
      )}
      <div className={`page-shell ${view === 'camera' ? 'camera-page-shell camera-app-shell' : ''}`}>

      {view === 'cadastro' && (
        <section className="card">
          <div className="cadastro-header">
            <h2>Gestao de cadastro</h2>
            <div className="menu-buttons">
              <button
                type="button"
                className={`menu-btn ${cadastroMenu === 'cadastro' ? 'active' : ''}`}
                onClick={() => setCadastroMenu('cadastro')}
              >
                Cadastro
              </button>
              <button
                type="button"
                className={`menu-btn ${cadastroMenu === 'registros' ? 'active' : ''}`}
                onClick={() => setCadastroMenu('registros')}
              >
                Registros
              </button>
              <button
                type="button"
                className={`menu-btn ${cadastroMenu === 'historicos' ? 'active' : ''}`}
                onClick={() => setCadastroMenu('historicos')}
              >
                Historicos
              </button>
            </div>
          </div>

          {cadastroMenu === 'cadastro' && (
            <>
              <form className="grid-form" onSubmit={handleCadastroSubmit}>
            <label>
              Nome da empresa <span className="req-star">*</span>
              <input name="companyName" required style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              Responsavel pela empresa (terceiro)
              <input name="thirdPartyResponsible" style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              Lider da equipe
              <input name="teamLeader" style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              Nome do responsavel pelo notebook <span className="req-star">*</span>
              <input name="notebookResponsibleName" required style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              Telefone de contato
              <input name="contactPhone" />
            </label>
            <label>
              Setor
              <input name="department" style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              T-number (matricula/planta) <span className="req-star">*</span>
              <input name="matriculaPlanta" required style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              Ativo do dispositivo <span className="req-star">*</span>
              <input name="assetCode" required style={{ textTransform: 'uppercase' }} />
            </label>
            <label>
              Status de acesso
              <select name="status" defaultValue="LIBERADO">
                <option value="LIBERADO">Autorizado</option>
                <option value="BLOQUEADO">Não autorizado</option>
              </select>
            </label>
            <label className="full-width">
              Foto do responsavel do dispositivo <span className="req-star">*</span>
              <input type="file" name="responsiblePhoto" accept="image/*" required />
            </label>

            <div className="full-width actions">
              <button type="submit" disabled={cadastroLoading}>
                {cadastroLoading ? 'Salvando...' : 'Salvar cadastro e gerar Código'}
              </button>
            </div>
              </form>

              {cadastroError && <p className="error-msg">{cadastroError}</p>}
              {cadastroSuccess && (
                <div className="result-box success-box">
                  <p>
                    Cadastro concluido para o ativo <strong>{cadastroSuccess.assetCode}</strong>
                  </p>
                </div>
              )}
            </>
          )}

          {cadastroMenu === 'registros' && (
            <div className="result-box records-box">
              <div className="filters-grid">
                <label>
                  Nome
                  <input
                    value={recordsNameFilter}
                    onChange={(event) => setRecordsNameFilter(event.target.value)}
                    placeholder="Responsavel, lider, empresa..."
                  />
                </label>
                <label>
                  T-number
                  <input
                    value={recordsTNumberFilter}
                    onChange={(event) => setRecordsTNumberFilter(event.target.value)}
                    placeholder="Ex: T12345"
                  />
                </label>
                <label>
                  Data inicial
                  <input type="date" value={recordsDateFrom} onChange={(event) => setRecordsDateFrom(event.target.value)} />
                </label>
                <label>
                  Data final
                  <input type="date" value={recordsDateTo} onChange={(event) => setRecordsDateTo(event.target.value)} />
                </label>
                <label>
                  Hora inicial
                  <input type="time" value={recordsTimeFrom} onChange={(event) => setRecordsTimeFrom(event.target.value)} />
                </label>
                <label>
                  Hora final
                  <input type="time" value={recordsTimeTo} onChange={(event) => setRecordsTimeTo(event.target.value)} />
                </label>
                <label>
                  Status
                  <select value={recordStatusFilter} onChange={(event) => setRecordStatusFilter(event.target.value as 'TODOS' | 'LIBERADO' | 'BLOQUEADO')}>
                    <option value="TODOS">Todos</option>
                    <option value="LIBERADO">Autorizado</option>
                    <option value="BLOQUEADO">Nao autorizado</option>
                  </select>
                </label>
              </div>

              <div className="download-buttons">
                <button type="button" className="download-btn pdf-btn" onClick={downloadPDF}>
                  Baixar PDF
                </button>
                <button type="button" className="download-btn excel-btn" onClick={downloadExcel}>
                  Baixar Excel
                </button>
                <button type="button" className="download-btn" onClick={() => void loadDevices()}>
                  Atualizar
                </button>
              </div>


              {recordsActionError && <p className="error-msg">{recordsActionError}</p>}

              {editingDeviceId && (
                <form className="grid-form edit-panel" onSubmit={saveEditedDevice}>
                  <label>
                    Nome da empresa <span className="req-star">*</span>
                    <input
                      value={editForm.companyName}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, companyName: event.target.value.toUpperCase() }))}
                      required
                    />
                  </label>
                  <label>
                    Responsavel pela empresa (terceiro)
                    <input
                      value={editForm.thirdPartyResponsible}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, thirdPartyResponsible: event.target.value.toUpperCase() }))
                      }
                    />
                  </label>
                  <label>
                    Lider da equipe
                    <input
                      value={editForm.teamLeader}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, teamLeader: event.target.value.toUpperCase() }))}
                    />
                  </label>
                  <label>
                    Nome do responsavel pelo notebook <span className="req-star">*</span>
                    <input
                      value={editForm.notebookResponsibleName}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, notebookResponsibleName: event.target.value.toUpperCase() }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Telefone de contato
                    <input
                      value={editForm.contactPhone}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
                    />
                  </label>
                  <label>
                    Setor
                    <input
                      value={editForm.department}
                      onChange={(event) => setEditForm((prev) => ({ ...prev, department: event.target.value.toUpperCase() }))}
                    />
                  </label>
                  <label>
                    T-number <span className="req-star">*</span>
                    <input
                      value={editForm.matriculaPlanta}
                      onChange={(event) =>
                        setEditForm((prev) => ({ ...prev, matriculaPlanta: event.target.value.toUpperCase() }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Status de acesso
                    <select
                      value={editForm.status}
                      onChange={(event) =>
                        setEditForm((prev) => ({
                          ...prev,
                          status: event.target.value as DeviceStatus,
                        }))
                      }
                    >
                      <option value="LIBERADO">Autorizado</option>
                      <option value="BLOQUEADO">Não autorizado</option>
                    </select>
                  </label>

                  <div className="full-width actions">
                    <button type="submit" disabled={recordsActionLoading}>
                      {recordsActionLoading ? 'Salvando...' : 'Salvar edicao'}
                    </button>
                    <button
                      type="button"
                      disabled={recordsActionLoading}
                      onClick={() => {
                        setEditingDeviceId(null)
                        setEditForm(INITIAL_EDIT_FORM)
                      }}
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              )}

              {devicesLoading && <p className="loading-msg">Carregando registros...</p>}
              {devicesError && <p className="error-msg">{devicesError}</p>}

              {!devicesLoading && (
                <>
                  <p className="status-line">Total filtrado: <strong>{filteredDevices.length}</strong></p>
                  <div className="table-wrapper">
                    <table className="records-table">
                      <thead>
                        <tr>
                          <th>Ativo</th>
                          <th>Nome</th>
                          <th>Empresa</th>
                          <th>Foto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredDevices.length === 0 && (
                          <tr>
                            <td colSpan={4} className="empty-cell">Nenhum registro encontrado.</td>
                          </tr>
                        )}
                        {filteredDevices.map((device) => (
                          <tr key={device.id}>
                            <td>{device.assetCode}</td>
                            <td>{device.notebookResponsibleName}</td>
                            <td>{device.companyName}</td>
                            <td>
                              {device.responsiblePhotoPath ? (
                                <img
                                  src={resolveApiUrl(device.responsiblePhotoPath)}
                                  alt={`Foto de ${device.notebookResponsibleName}`}
                                  className="table-photo"
                                />
                              ) : (
                                <span className="no-photo">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {cadastroMenu === 'historicos' && (
            <div className="result-box records-box">
              <div className="filters-grid">
                <label>
                  Nome
                  <input
                    value={historyNameFilter}
                    onChange={(event) => setHistoryNameFilter(event.target.value)}
                    placeholder="Responsavel, lider, empresa..."
                  />
                </label>
                <label>
                  T-number
                  <input
                    value={historyTNumberFilter}
                    onChange={(event) => setHistoryTNumberFilter(event.target.value)}
                    placeholder="Ex: T12345"
                  />
                </label>
                <label>
                  Data inicial
                  <input type="date" value={historyDateFrom} onChange={(event) => setHistoryDateFrom(event.target.value)} />
                </label>
                <label>
                  Data final
                  <input type="date" value={historyDateTo} onChange={(event) => setHistoryDateTo(event.target.value)} />
                </label>
                <label>
                  Hora inicial
                  <input type="time" value={historyTimeFrom} onChange={(event) => setHistoryTimeFrom(event.target.value)} />
                </label>
                <label>
                  Hora final
                  <input type="time" value={historyTimeTo} onChange={(event) => setHistoryTimeTo(event.target.value)} />
                </label>
                <label>
                  Status
                  <select value={historyStatusFilter} onChange={(event) => setHistoryStatusFilter(event.target.value as 'TODOS' | 'LIBERADO' | 'BLOQUEADO')}>
                    <option value="TODOS">Todos</option>
                    <option value="LIBERADO">Autorizado</option>
                    <option value="BLOQUEADO">Nao autorizado</option>
                  </select>
                </label>
              </div>

              <div className="download-buttons">
                <button type="button" className="download-btn pdf-btn" onClick={downloadHistoryPDF}>
                  Baixar PDF
                </button>
                <button type="button" className="download-btn excel-btn" onClick={downloadHistoryExcel}>
                  Baixar Excel
                </button>
                <button type="button" className="download-btn" onClick={() => void loadValidationLogs()}>
                  Atualizar logs
                </button>
              </div>

              {validationLogsLoading && <p className="loading-msg">Carregando historico...</p>}
              {validationLogsError && <p className="error-msg">{validationLogsError}</p>}

              {!validationLogsLoading && (
                <>
                  <p className="status-line">Total filtrado: <strong>{filteredValidationLogs.length}</strong></p>
                  <div className="table-wrapper">
                    <table className="records-table">
                      <thead>
                        <tr>
                          <th>Data/Hora</th>
                          <th>Ativo</th>
                          <th>T-number</th>
                          <th>Responsavel</th>
                          <th>Empresa</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredValidationLogs.length === 0 && (
                          <tr>
                            <td colSpan={6} className="empty-cell">Nenhum log encontrado.</td>
                          </tr>
                        )}
                        {filteredValidationLogs.map((entry) => (
                          <tr key={`${entry.device.id}-${entry.validatedAt}`}>
                            <td>{new Date(entry.validatedAt).toLocaleString('pt-BR')}</td>
                            <td>{entry.device.assetCode}</td>
                            <td>{entry.device.matriculaPlanta}</td>
                            <td>{entry.device.notebookResponsibleName}</td>
                            <td>{entry.device.companyName}</td>
                            <td>
                              <span className={`badge ${getStatusMeta(entry.device.status).badgeClass}`}>
                                {getStatusMeta(entry.device.status).label}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {view === 'camera' && (
        <section className="camera-fullscreen" aria-label="Leitor de Código de Barras em tela cheia">
          {scannerOpen && <div id="barcode-reader" ref={scannerRef} className="barcode-reader barcode-reader-fullscreen" />}
          {!canUseEmbeddedCamera && (
            <p className="error-msg camera-overlay-msg">
              Leitura continua bloqueada neste acesso. Abra o validador em HTTPS para manter a camera aberta direto.
            </p>
          )}
          {scannerError && <p className="error-msg camera-overlay-msg">{scannerError}</p>}
          {validationResult && (
            <div className={'camera-result-overlay ' + getStatusMeta(validationResult.device.status).cardClass}>
              <h3 className={'status-banner ' + getStatusMeta(validationResult.device.status).bannerClass}>
                {getStatusMeta(validationResult.device.status).label}
              </h3>
              <p className="camera-result-name">{validationResult.device.notebookResponsibleName}</p>
              <p className="camera-result-asset">Ativo: {validationResult.device.assetCode}</p>
            </div>
          )}
        </section>
      )}

      {view === 'painel' && (
        <section>
          <div className="painel-grid">
            {Array.from({ length: PAINEL_COUNT }).map((_, index) => {
              const result = painelResults[index]
              const error = painelErrors[index]
              const camera = painelCameras[index]
              const statusMeta = result ? getStatusMeta(result.device.status) : null
              const cardClass = result ? (statusMeta?.cardClass ?? '') : 'status-neutral'

              return (
                <div key={index} className={'card painel-card ' + cardClass}>
                  <div id={'painel-reader-' + index} ref={(el) => { painelScannerRefs.current[index] = el }} className="painel-hidden-scanner" />

                  <div className="painel-card-header">
                    <span className="painel-card-title">Painel {index + 1}</span>
                    {camera && <span className="painel-card-camera-label" title={camera.label}>{camera.label}</span>}
                    {!camera && <span className="painel-card-camera-label">Sem camera</span>}
                  </div>

                  {painelScanning && !result && !error && (
                    <div className="painel-waiting">
                      <div className="painel-waiting-dot" />
                      <p>Aguardando leitura...</p>
                    </div>
                  )}

                  {error && !result && (
                    <div className="result-box">
                      <p className="error-msg">{error}</p>
                    </div>
                  )}

                  {!painelScanning && !result && !error && (
                    <div className="result-box">
                      <p>Inicializando cameras...</p>
                    </div>
                  )}

                  {result && (
                    <div className="painel-result">
                      <h3 className={'status-banner ' + (statusMeta?.bannerClass ?? 'status-banner-blocked')}>
                        {statusMeta?.label ?? 'NÃO AUTORIZADO'}
                      </h3>
                      <div className="painel-result-content">
                        <img
                          src={resolveApiUrl(result.device.responsiblePhotoPath)}
                          alt="Foto"
                          className="responsible-photo"
                        />
                        <div className="painel-result-info">
                          <p className="painel-result-name">{result.device.notebookResponsibleName}</p>
                          <p className="subtle-line">{result.device.companyName}</p>
                          <p className="subtle-line">Ativo: {result.device.assetCode}</p>
                          <p className="subtle-line">T-number: {result.device.matriculaPlanta}</p>
                          {result.validationPhotoPath && (
                            <div className="painel-validation-photo-wrapper">
                              <img
                                src={resolveApiUrl(result.validationPhotoPath)}
                                alt="Foto validacao"
                                className="painel-validation-photo"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      </div>
    </>
  )
}

export default App
