import SchedulePageClient from './components/SchedulePageClient';
import Floors from '@/app/lib/floorInfo';

export default function Page() {
    return (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <SchedulePageClient floors={Floors()} />
        </div>
    );
}
