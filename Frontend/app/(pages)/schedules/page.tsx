import SchedulePageClient from './components/SchedulePageClient';
import PermissionGuard from "@/app/components/common/PermissionGuard";
import Floors from '@/app/lib/floorInfo';

export default function Page() {
    return (
        <PermissionGuard requiredPermissions={["schedule-list"]}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <SchedulePageClient floors={Floors()} />
            </div>
        </PermissionGuard>
    );
}
