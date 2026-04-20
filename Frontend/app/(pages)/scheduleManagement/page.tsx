import SchedulePageClient from './components/SchedulePageClient';
import PermissionGuard from "@/app/components/common/PermissionGuard";
import getFloors from '@/app/lib/floorInfo';

export default async function Page() {
    const floors = await getFloors();
    return (
        <PermissionGuard requiredPermissions={["schedule-list"]}>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <SchedulePageClient floors={floors} />
            </div>
        </PermissionGuard>
    );
}
