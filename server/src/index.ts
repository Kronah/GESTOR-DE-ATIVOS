import cors from 'cors'
import express from 'express'
import multer from 'multer'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { PrismaClient, DeviceStatus } from '@prisma/client'

const app = express()
const validationApp = express()
const prisma = new PrismaClient()
const port = Number(process.env.PORT ?? 4000)
const validationPort = Number(process.env.VALIDATION_PORT ?? 4100)
const workspaceRoot = process.cwd()
const uploadsDir = path.join(workspaceRoot, 'uploads')

type ValidationBroadcastPayload = {
  validatedAt: string
  device: {
    id: number
    companyName: string
    thirdPartyResponsible: string | null
    teamLeader: string
    notebookResponsibleName: string
    department: string
    matriculaPlanta: string
    responsiblePhotoPath: string
    assetCode: string
    status: DeviceStatus
  }
  validationPhotoPath?: string
}

let latestValidation: ValidationBroadcastPayload | null = null
let validationLogHistory: ValidationBroadcastPayload[] = []
const lastValidationByDeviceId = new Map<number, number>()
const ANTI_PASSBACK_MS = 5 * 60 * 1000
const streamClients = new Set<express.Response>()

const broadcastValidation = (payload: ValidationBroadcastPayload) => {
  latestValidation = payload
  validationLogHistory = [payload, ...validationLogHistory].slice(0, 500)
  const eventData = `data: ${JSON.stringify(payload)}\n\n`
  for (const client of streamClients) {
    client.write(eventData)
  }
}

const toPosixPath = (inputPath: string) => inputPath.split(path.sep).join('/')

const relativeUploadsPath = (absolutePath: string) => {
  const relative = path.relative(workspaceRoot, absolutePath)
  return `/${toPosixPath(relative)}`
}

const workspaceAbsolutePath = (workspaceRelativePath: string) => {
  const normalized = workspaceRelativePath.replace(/^[/\\]+/, '').split('/').join(path.sep)
  return path.join(workspaceRoot, normalized)
}

const ensureUploadDirectories = async () => {
  await fs.mkdir(path.join(uploadsDir, 'responsibles'), { recursive: true })
  await fs.mkdir(path.join(uploadsDir, 'validations'), { recursive: true })
}

const responsibleStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(uploadsDir, 'responsibles'))
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg'
    cb(null, `${Date.now()}-${randomUUID()}${ext}`)
  },
})

const validationStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.join(uploadsDir, 'validations'))
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg'
    cb(null, `${Date.now()}-${randomUUID()}${ext}`)
  },
})

const cadastroUpload = multer({ storage: responsibleStorage })
const validationUpload = multer({ storage: validationStorage })

app.use(cors())
app.use(express.json())
app.use('/uploads', express.static(uploadsDir))

validationApp.use(cors())
validationApp.use(express.json())
validationApp.use('/uploads', express.static(uploadsDir))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/devices', async (_req, res) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    })
    res.json(devices)
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar dispositivos' })
  }
})

app.post('/api/devices', cadastroUpload.single('responsiblePhoto'), async (req, res) => {
  try {
    const {
      companyName,
      thirdPartyResponsible,
      teamLeader,
      notebookResponsibleName,
      contactPhone,
      department,
      matriculaPlanta,
      assetCode,
      status,
    } = req.body as Record<string, string | undefined>

    const responsiblePhoto = req.file

    if (
      !companyName ||
      !teamLeader ||
      !notebookResponsibleName ||
      !contactPhone ||
      !department ||
      !matriculaPlanta ||
      !assetCode ||
      !responsiblePhoto
    ) {
      return res.status(400).json({ error: 'Campos obrigatorios ausentes no cadastro.' })
    }

    const normalizedAsset = assetCode.trim().toUpperCase()

    const device = await prisma.device.create({
      data: {
        companyName: companyName.trim(),
        thirdPartyResponsible: thirdPartyResponsible?.trim() || null,
        teamLeader: teamLeader.trim(),
        notebookResponsibleName: notebookResponsibleName.trim(),
        contactPhone: contactPhone.trim(),
        department: department.trim(),
        matriculaPlanta: matriculaPlanta.trim(),
        responsiblePhotoPath: relativeUploadsPath(responsiblePhoto.path),
        assetCode: normalizedAsset,
        status: status === DeviceStatus.BLOQUEADO ? DeviceStatus.BLOQUEADO : DeviceStatus.LIBERADO,
      },
    })

    return res.status(201).json(device)
  } catch (error) {
    const isUniqueError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'

    if (isUniqueError) {
      return res.status(409).json({ error: 'Ativo ja cadastrado no sistema.' })
    }

    return res.status(500).json({ error: 'Erro interno ao cadastrar dispositivo.' })
  }
})

app.get('/api/devices/by-code/:assetCode', async (req, res) => {
  const assetCode = req.params.assetCode
  const device = await prisma.device.findUnique({ where: { assetCode } })

  if (!device) {
    return res.status(404).json({ error: 'Dispositivo nao encontrado para este codigo de barras.' })
  }

  return res.json(device)
})

app.put('/api/devices/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'ID do dispositivo invalido.' })
    }

    const {
      companyName,
      thirdPartyResponsible,
      teamLeader,
      notebookResponsibleName,
      contactPhone,
      department,
      matriculaPlanta,
      status,
    } = req.body as Record<string, string | undefined>

    if (
      !companyName ||
      !teamLeader ||
      !notebookResponsibleName ||
      !contactPhone ||
      !department ||
      !matriculaPlanta
    ) {
      return res.status(400).json({ error: 'Campos obrigatorios ausentes para edicao.' })
    }

    const updated = await prisma.device.update({
      where: { id },
      data: {
        companyName: companyName.trim(),
        thirdPartyResponsible: thirdPartyResponsible?.trim() || null,
        teamLeader: teamLeader.trim(),
        notebookResponsibleName: notebookResponsibleName.trim(),
        contactPhone: contactPhone.trim(),
        department: department.trim(),
        matriculaPlanta: matriculaPlanta.trim(),
        status: status === DeviceStatus.BLOQUEADO ? DeviceStatus.BLOQUEADO : DeviceStatus.LIBERADO,
      },
    })

    return res.json(updated)
  } catch (error) {
    const isNotFoundError =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2025'

    if (isNotFoundError) {
      return res.status(404).json({ error: 'Dispositivo nao encontrado para edicao.' })
    }

    return res.status(500).json({ error: 'Erro interno ao editar dispositivo.' })
  }
})

app.delete('/api/devices/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'ID do dispositivo invalido.' })
    }

    const device = await prisma.device.findUnique({ where: { id } })
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo nao encontrado para exclusao.' })
    }

    await prisma.device.delete({ where: { id } })

    lastValidationByDeviceId.delete(id)
    validationLogHistory = validationLogHistory.filter((entry) => entry.device.id !== id)
    if (latestValidation?.device.id === id) {
      latestValidation = null
    }

    await Promise.all([
      fs.unlink(workspaceAbsolutePath(device.responsiblePhotoPath)).catch(() => {
        // Ignore missing photo file during cleanup.
      }),
    ])

    return res.status(204).send()
  } catch (error) {
    return res.status(500).json({ error: 'Erro interno ao excluir dispositivo.' })
  }
})

app.get('/api/validation/latest', (_req, res) => {
  res.json({ latestValidation })
})

app.get('/api/validation/logs', (_req, res) => {
  res.json({ logs: validationLogHistory })
})

app.get('/api/validation/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  streamClients.add(res)

  if (latestValidation) {
    res.write(`data: ${JSON.stringify(latestValidation)}\n\n`)
  }

  req.on('close', () => {
    streamClients.delete(res)
  })
})

const handleValidate: express.RequestHandler = async (req, res) => {
  const assetCode = String(req.body.assetCode ?? '').trim()

  if (!assetCode) {
    res.status(400).json({ error: 'Informe o Codigo de Barras para validacao.' })
    return
  }

  const device = await prisma.device.findUnique({ where: { assetCode } })

  if (!device) {
    res.status(404).json({ error: 'Codigo de Barras nao encontrado na base de cadastro.' })
    return
  }

  const now = Date.now()
  const lastValidationAt = lastValidationByDeviceId.get(device.id)
  if (lastValidationAt && now - lastValidationAt < ANTI_PASSBACK_MS) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {
        // Ignore cleanup failures for temporary validation photos.
      })
    }

    const remainingMs = ANTI_PASSBACK_MS - (now - lastValidationAt)
    const remainingSeconds = Math.ceil(remainingMs / 1000)
    const remainingMinutes = Math.ceil(remainingSeconds / 60)

    res.status(429).json({
      error: `Antipassback ativo para este Codigo de Barras. Nova leitura em ${remainingMinutes} minuto(s).`,
      code: 'ANTI_PASSBACK_ACTIVE',
      remainingSeconds,
      nextAllowedAt: new Date(lastValidationAt + ANTI_PASSBACK_MS).toISOString(),
    })
    return
  }

  const validationPhotoPath = req.file ? relativeUploadsPath(req.file.path) : undefined
  lastValidationByDeviceId.set(device.id, now)

  broadcastValidation({
    validatedAt: new Date(now).toISOString(),
    device: {
      id: device.id,
      companyName: device.companyName,
      thirdPartyResponsible: device.thirdPartyResponsible,
      teamLeader: device.teamLeader,
      notebookResponsibleName: device.notebookResponsibleName,
      department: device.department,
      matriculaPlanta: device.matriculaPlanta,
      responsiblePhotoPath: device.responsiblePhotoPath,
      assetCode: device.assetCode,
      status: device.status,
    },
    validationPhotoPath,
  })

  res.json({
    device,
    validationPhotoPath,
  })
}

app.post('/api/validate', validationUpload.single('assetPhoto'), handleValidate)
validationApp.post('/api/validate', validationUpload.single('assetPhoto'), handleValidate)

const start = async () => {
  await ensureUploadDirectories()
  app.listen(port, () => {
    console.log(`API de ativos online em http://localhost:${port}`)
  })
  validationApp.listen(validationPort, () => {
    console.log(`API de validacao online em http://localhost:${validationPort}`)
  })
}

void start()
