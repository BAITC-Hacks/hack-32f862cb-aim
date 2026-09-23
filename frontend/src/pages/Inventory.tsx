import { t, useLanguage } from '../i18n'
import { UploadCloud } from 'lucide-react'
import { useShell } from '../components/Layout'
import { Button, PageHeader } from '../components/ui'
import { InventoryTable } from '../components/InventoryTable'
import { useWorkspace } from '../store'

export function Inventory() {
  useLanguage()
  const { showProduct, openImport } = useShell()
  const ws = useWorkspace()
  return (
    <div className="page">
      <PageHeader
        eyebrow={t('Workspace / Inventory')}
        title={t('Your inventory, in focus.')}
        description={t('Every product. Every stock level. A clear view of what comes next.')}
        action={
          <Button icon={UploadCloud} variant="primary" onClick={openImport} disabled={!ws.canPlan}>
            {t('Import inventory')}
          </Button>
        }
      />
      {ws.mode === 'live' && !ws.planId && ws.products.length > 0 && (
        <div className="info-banner">
          {t('Your catalog is ready. Run a forecast to calculate risk and recommended order quantities.')}
        </div>
      )}
      <InventoryTable onSelect={showProduct} />
    </div>
  )
}
