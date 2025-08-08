import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, updateDoc, query, setDoc } from 'firebase/firestore';

// --- Helper Functions & Initial Data ---
const DIETARY_OPTIONS = { gf: 'GF', df: 'DF', ve: 'VE', vg: 'VG', nt: 'NT' };

const formatTime = (time24) => {
    if (!time24) return '';
    const [hours, minutes] = time24.split(':');
    const h = parseInt(hours, 10);
    const m = parseInt(minutes, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m < 10 ? '0' : ''}${m} ${ampm}`;
};

const formatCurrentTime = (date) => {
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0'+minutes : minutes;
    return { time: `${hours}:${minutes}`, ampm: ampm };
};

const calculateEndTime = (startTime, activityBlocks) => {
    if (!startTime || !activityBlocks) return '';
    const totalDuration = activityBlocks.reduce((sum, block) => sum + (block.duration || 0), 0);
    const [hours, minutes] = startTime.split(':').map(Number);
    const startDate = new Date();
    startDate.setHours(hours, minutes, 0, 0);
    const endDate = new Date(startDate.getTime() + totalDuration * 60000);
    const endHours = endDate.getHours();
    const endMinutes = endDate.getMinutes();
    return `${endHours < 10 ? '0' : ''}${endHours}:${endMinutes < 10 ? '0' : ''}${endMinutes}`;
};

const formatDuration = (minutes) => {
    if (!minutes) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    let result = '';
    if (h > 0) result += `${h}h`;
    if (m > 0) result += ` ${m}m`;
    return result.trim();
};

// --- Icon Components ---
const PlusCircleIcon = (props) => (<svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>);
const Trash2Icon = (props) => (<svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>);
const SettingsIcon = (props) => (<svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>);


// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyCdv7G2uxG-TqHmrAkim8NeLsJApt3tFlM",
  authDomain: "checkin-kitchen-app.firebaseapp.com",
  projectId: "checkin-kitchen-app",
  storageBucket: "checkin-kitchen-app.appspot.com",
  messagingSenderId: "496734911234",
  appId: "1:496734911234:web:db8be764640f9a2476e01b"
};

// --- Main App Component ---
export default function App() {
    const [allGroups, setAllGroups] = useState([]);
    const [foodItems, setFoodItems] = useState({ pizzas: {}, snacks: {} });
    const [currentTime, setCurrentTime] = useState(new Date());
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isFoodModalOpen, setIsFoodModalOpen] = useState(false);
    const [view, setView] = useState('KITCHEN'); // 'KITCHEN' or 'FLOW'

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const initializeFirebase = () => {
            try {
                const app = initializeApp(firebaseConfig);
                const authInstance = getAuth(app);
                const firestore = getFirestore(app);
                setDb(firestore);
                setAuth(authInstance);

                onAuthStateChanged(authInstance, (user) => {
                    if (user) {
                        setIsLoading(false);
                    } else {
                        signInAnonymously(authInstance).catch(authError => {
                            console.error("Anonymous sign-in failed:", authError);
                            setError("Could not authenticate.");
                            setIsLoading(false);
                        });
                    }
                });
            } catch (e) {
                console.error("Firebase initialization error:", e);
                setError("Could not connect to the service.");
                setIsLoading(false);
            }
        };
        initializeFirebase();
    }, []);

    // --- Data Fetching and Processing ---
    useEffect(() => {
        if (!db || !auth?.currentUser) return;

        const foodItemsCollectionRef = collection(db, "foodItems");
        const unsubscribeFoodItems = onSnapshot(foodItemsCollectionRef, (snapshot) => {
            const items = { pizzas: {}, snacks: {} };
            snapshot.forEach(doc => { if (doc.id === 'pizzas' || doc.id === 'snacks') items[doc.id] = doc.data(); });
            setFoodItems(items);
        });

        const q = query(collection(db, "groups"));
        const unsubscribeGroups = onSnapshot(q, (snapshot) => {
            const groupsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            groupsData.sort((a, b) => a.time.localeCompare(b.time));
            setAllGroups(groupsData);
        }, err => console.error("Error fetching groups:", err));

        return () => { unsubscribeGroups(); unsubscribeFoodItems(); };
    }, [db, auth?.currentUser]);

    // --- Data Manipulation ---
    const updateFoodOrderItem = async (groupId, itemKey, currentCount, operation) => {
        if (!db) return;
        const newCount = operation === 'add' ? currentCount + 1 : Math.max(0, currentCount - 1);
        await updateDoc(doc(db, "groups", groupId), { [`foodOrder.${itemKey}`]: newCount });
    };
    
    const toggleFoodReady = async (groupId, currentStatus) => {
        if (!db) return;
        await updateDoc(doc(db, "groups", groupId), { 'status.foodReady': !currentStatus });
    };

    const addFoodItem = async (category, name) => {
        if (!db || !name.trim()) return;
        const key = name.trim().toLowerCase().replace(/\s+/g, '');
        await setDoc(doc(db, "foodItems", category), { [key]: name.trim() }, { merge: true });
    };

    const deleteFoodItem = async (category, key) => {
        if (!db) return;
        const docRef = doc(db, "foodItems", category);
        const updatedItems = { ...foodItems[category] };
        delete updatedItems[key];
        await setDoc(docRef, updatedItems);
    };

    // Calculate totals for header
    const foodGroups = allGroups.filter(g => g.package === 'Food' || g.package === 'Food & Drink');
    const totalPizzas = foodGroups.reduce((sum, group) => sum + Object.keys(foodItems.pizzas).reduce((groupSum, key) => groupSum + (group.foodOrder?.[key] || 0), 0), 0);
    const totalSnacks = foodGroups.reduce((sum, group) => sum + Object.keys(foodItems.snacks).reduce((groupSum, key) => groupSum + (group.foodOrder?.[key] || 0), 0), 0);
    const totalPizzaEstimate = foodGroups.reduce((sum, group) => sum + Math.ceil(group.teamSize / 2), 0);
    const totalSnackEstimate = foodGroups.reduce((sum, group) => sum + Math.ceil(group.teamSize / 2), 0);
    const { time, ampm } = formatCurrentTime(currentTime);

    const activeKitchenGroups = foodGroups.filter(g => {
        const { brief, chkd, food, paid, done } = g.status || {};
        return !(brief && chkd && food && paid && done);
    });
    const completedKitchenGroups = foodGroups.filter(g => {
        const { brief, chkd, food, paid, done } = g.status || {};
        return brief && chkd && food && paid && done;
    });

    if (error) return (<div className="bg-black text-white min-h-screen flex items-center justify-center font-inter"><div className="bg-red-500 p-8 rounded-lg shadow-2xl text-center"><h2 className="text-2xl font-bold mb-2">Error</h2><p>{error}</p></div></div>);
    if (isLoading) return (<div className="bg-black text-white min-h-screen flex items-center justify-center font-inter"><p>Connecting to Kitchen Service...</p></div>);

    return (
        <>
            <script src="https://cdn.tailwindcss.com"></script>
            <style type="text/tailwindcss">{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap');
                body, input, select, textarea, button, span { 
                    font-family: 'Inter', sans-serif !important; 
                }
            `}</style>
            <div className="bg-black min-h-screen font-inter text-white p-4 sm:p-6 lg:p-8">
                <div className="max-w-7xl mx-auto">
                    <header className="flex justify-between items-center mb-6">
                        <div className="flex items-center gap-4">
                            <img src="https://images.squarespace-cdn.com/content/v1/6280b73cb41908114afef4a1/5bb4bba5-e8c3-4c38-b672-08c0b4ee1f4c/serve-social.png" alt="Serve Social Logo" className="h-10" />
                            <div className="bg-gray-800 p-1 rounded-lg flex">
                                <button onClick={() => setView('KITCHEN')} className={`px-4 py-1 rounded-md text-sm font-bold ${view === 'KITCHEN' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>KITCHEN</button>
                                <button onClick={() => setView('FLOW')} className={`px-4 py-1 rounded-md text-sm font-bold ${view === 'FLOW' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}>FLOW</button>
                            </div>
                        </div>
                        <div className="bg-transparent border border-white px-4 py-2 rounded-lg text-center">
                            <p className="text-3xl font-bold">
                                {time}<span className="text-lg ml-1">{ampm}</span>
                            </p>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="bg-gray-800 px-4 py-2 rounded-lg text-center">
                                <p className="text-3xl font-bold">{totalPizzas} / {totalPizzaEstimate}</p>
                                <p className="text-xs text-gray-400">Total Pizzas</p>
                            </div>
                            <div className="bg-gray-800 px-4 py-2 rounded-lg text-center">
                                <p className="text-3xl font-bold">{totalSnacks} / {totalSnackEstimate}</p>
                                <p className="text-xs text-gray-400">Total Snacks</p>
                            </div>
                            <button onClick={() => setIsFoodModalOpen(true)} className="ml-4 bg-gray-700 hover:bg-gray-600 text-white font-bold p-2 rounded-lg"><SettingsIcon className="w-5 h-5"/></button>
                        </div>
                    </header>
                    
                    {view === 'KITCHEN' ? (
                        <>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {activeKitchenGroups.map((group) => (
                                    <KitchenCard key={group.id} group={group} foodItems={foodItems} onUpdateFood={updateFoodOrderItem} onToggleFoodReady={toggleFoodReady}/>
                                ))}
                                {activeKitchenGroups.length === 0 && !isLoading && (
                                    <div className="col-span-full text-center py-16 px-4 bg-gray-900 rounded-lg"><h3 className="text-xl font-semibold text-gray-300">No Active Food Orders</h3><p className="text-gray-500 mt-2">Groups with food packages will appear here automatically.</p></div>
                                )}
                            </div>
                            {completedKitchenGroups.length > 0 && (
                                <div className="mt-12">
                                     <h2 className="text-2xl font-bold tracking-tighter mb-4 pb-2 border-b border-gray-700">Completed Orders</h2>
                                     <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                        {completedKitchenGroups.map(group => <CompletedKitchenCard key={group.id} group={group} foodItems={foodItems} />)}
                                     </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="space-y-4">
                            {allGroups.map(group => <FlowSummaryCard key={group.id} group={group} foodItems={foodItems} />)}
                        </div>
                    )}
                </div>
                <FoodManagementModal isOpen={isFoodModalOpen} onClose={() => setIsFoodModalOpen(false)} foodItems={foodItems} onAdd={addFoodItem} onDelete={deleteFoodItem} />
            </div>
        </>
    );
}

// --- Components ---
const KitchenCard = ({ group, foodItems, onUpdateFood, onToggleFoodReady }) => {
    const { teamName, teamSize, time, dietary, foodOrder, assignedAreas, activityBlocks, status } = group;
    const dietarySummary = Object.entries(dietary || {}).filter(([, count]) => count > 0);
    const endTime = calculateEndTime(time, activityBlocks);
    const activitySummary = (activityBlocks || []).map(block => `${formatDuration(block.duration)} ${block.activities.join(' + ')}`).join(' → ');
    const isFoodReady = status?.foodReady || false;
    const cardBorder = isFoodReady ? 'border-yellow-500 ring-2 ring-yellow-500/50' : 'border-gray-800';

    return (
        <div className={`bg-gray-900 rounded-2xl shadow-lg border flex flex-col transition-all duration-300 ${cardBorder}`}>
            <div className="p-4 border-b border-gray-800">
                <div className="flex justify-between items-center mb-2">
                    <h2 className="text-2xl font-bold text-white flex-grow">{teamName}</h2>
                    <div className="flex items-center gap-2">
                         <div className="bg-blue-600 w-12 h-12 flex items-center justify-center rounded-full text-3xl font-bold">{teamSize}</div>
                         <div className="bg-gray-800 px-3 py-1 rounded-md text-center">
                            <div className="text-lg">{formatTime(time)}</div>
                            <div className="text-xs text-gray-400">to {formatTime(endTime)}</div>
                         </div>
                    </div>
                </div>
                <p className="text-xs text-gray-400 mt-2">{activitySummary}</p>
                <div className="mt-2 text-left flex items-center gap-2">
                    <h4 className="text-xs text-gray-500 flex-shrink-0">Area</h4>
                    <div className="flex flex-wrap gap-1">{(assignedAreas || []).map(area => <span key={area} className="text-sm font-semibold bg-blue-900/50 text-blue-300 px-2 py-1 rounded">{area}</span>)}</div>
                </div>
                {dietarySummary.length > 0 && 
                    <div className="mt-2 text-left">
                        <div className="flex items-center gap-2">
                            <h4 className="text-xs text-gray-500 flex-shrink-0">Dietary</h4>
                            <div className="flex flex-wrap gap-2">
                                {dietarySummary.map(([key, count]) => <span key={key} className="text-sm font-semibold bg-amber-900/50 text-amber-300 px-2 py-1 rounded">{DIETARY_OPTIONS[key]} {count}</span>)}
                            </div>
                        </div>
                    </div>
                }
            </div>
            <div className="p-4 space-y-4 flex-grow">
                <FoodCategory title="Pizzas" items={foodItems.pizzas} foodOrder={foodOrder} teamSize={teamSize} onUpdateFood={(itemKey, count, op) => onUpdateFood(group.id, itemKey, count, op)} />
                <FoodCategory title="Snacks" items={foodItems.snacks} foodOrder={foodOrder} teamSize={teamSize} onUpdateFood={(itemKey, count, op) => onUpdateFood(group.id, itemKey, count, op)} />
            </div>
            <div className="p-2">
                <button onClick={() => onToggleFoodReady(group.id, isFoodReady)} className={`w-full font-bold py-3 rounded-lg transition-colors text-lg ${isFoodReady ? 'bg-yellow-500 text-black' : 'bg-gray-700 hover:bg-gray-600 text-white'}`}>
                    {isFoodReady ? 'Food Collected' : 'Food Ready'}
                </button>
            </div>
        </div>
    );
};

const FoodCategory = ({ title, items, foodOrder, teamSize, onUpdateFood }) => {
    const totalCount = Object.keys(items).reduce((sum, key) => sum + (foodOrder?.[key] || 0), 0);
    const recommendedCount = Math.ceil(teamSize / 2);
    return (
        <div>
            <div className="flex justify-between items-center mb-2"><h3 className="text-lg font-semibold text-gray-300">{title}</h3><span className="text-sm font-semibold bg-gray-700 px-2 py-1 rounded-md">{totalCount} / {recommendedCount}</span></div>
            <div className="space-y-2">
                {Object.entries(items).map(([key, name]) => {
                    const count = foodOrder?.[key] || 0;
                    return (<div key={key} className="flex justify-between items-center bg-gray-800 p-2 rounded-lg"><span className="text-white">{name}</span><div className="flex items-center gap-3"><button onClick={() => onUpdateFood(key, count, 'remove')} className="w-8 h-8 flex items-center justify-center bg-transparent border border-white rounded-full text-xl font-bold hover:bg-gray-700">-</button><span className="text-2xl font-bold text-white w-8 text-center">{count}</span><button onClick={() => onUpdateFood(key, count, 'add')} className="w-8 h-8 flex items-center justify-center bg-transparent border border-white rounded-full text-xl font-bold hover:bg-gray-700">+</button></div></div>);
                })}
            </div>
        </div>
    );
};

const CompletedKitchenCard = ({ group, foodItems }) => {
    let totalPizzas = Object.keys(foodItems.pizzas).reduce((sum, key) => sum + (group.foodOrder?.[key] || 0), 0);
    let totalSnacks = Object.keys(foodItems.snacks).reduce((sum, key) => sum + (group.foodOrder?.[key] || 0), 0);
    return (
        <div className="bg-green-900/20 rounded-lg p-3 border border-green-700/30"><div className="flex justify-between items-center"><span className="font-bold text-white">{group.teamName}</span><span className="text-sm text-gray-400">{formatTime(group.time)}</span></div><div className="flex justify-around text-center mt-2"><div><p className="font-bold text-lg">{totalPizzas}</p><p className="text-xs text-gray-400">Pizzas</p></div><div><p className="font-bold text-lg">{totalSnacks}</p><p className="text-xs text-gray-400">Snacks</p></div></div></div>
    );
};

const FlowSummaryCard = ({ group, foodItems }) => {
    const { brief, chkd, food, paid, done } = group.status || {};
    const isFullyComplete = brief && chkd && food && paid && done;
    const hasFoodPackage = group.package === 'Food' || group.package === 'Food & Drink';
    const dietarySummary = Object.entries(group.dietary || {}).filter(([, count]) => count > 0);
    const cardClasses = `rounded-2xl shadow-md border p-4 transition-all duration-300 ${isFullyComplete ? 'bg-green-900/40 border-green-700/50' : 'bg-gray-800 border-gray-700'}`;
    
    const totalPizzas = Object.keys(foodItems.pizzas || {}).reduce((sum, key) => sum + (group.foodOrder?.[key] || 0), 0);
    const totalSnacks = Object.keys(foodItems.snacks || {}).reduce((sum, key) => sum + (group.foodOrder?.[key] || 0), 0);
    const pizzaEstimate = Math.ceil((Number(group.teamSize) || 0) / 2);
    const snackEstimate = Math.ceil((Number(group.teamSize) || 0) / 2);
    const endTime = calculateEndTime(group.time, group.activityBlocks);
    const activitySummary = (group.activityBlocks || []).map(block => `${formatDuration(block.duration)} ${block.activities.join(' + ')}`).join(' → ');

    const PackageBadge = ({ pkg }) => {
        if (pkg === 'Food') return <span className="text-xs font-bold bg-yellow-500 text-yellow-900 px-2 py-1 rounded-md">{pkg}</span>;
        if (pkg === 'Food & Drink') return <span className="text-xs font-bold bg-purple-500 text-white px-2 py-1 rounded-md">{pkg}</span>;
        return <span className="text-xs text-gray-400">{pkg}</span>
    };

    return (
        <div className={cardClasses}>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="flex items-center gap-4 flex-grow min-w-0">
                    <div className="text-center w-24 flex-shrink-0">
                        <div className="text-lg">{formatTime(group.time)}</div>
                        <div className="text-sm text-gray-400">to {formatTime(endTime)}</div>
                        <div className="text-4xl font-bold text-white mt-1">{group.teamSize}</div>
                    </div>
                    <div className="min-w-0">
                        <span className="font-bold text-xl text-white truncate">{group.teamName}</span>
                         <div className="text-xs text-gray-400 flex flex-wrap items-center gap-x-2">
                            <PackageBadge pkg={group.package} />
                            {group.assignedTeamMember && <><span className="text-gray-600">|</span><span className="font-semibold text-gray-300">{group.assignedTeamMember}</span></>}
                        </div>
                         <p className="text-xs text-gray-400 mt-2">{activitySummary}</p>
                         <div className="mt-2 text-left flex items-center gap-2">
                            <h4 className="text-xs text-gray-500 flex-shrink-0">Area</h4>
                            <div className="flex flex-wrap gap-1">{(group.assignedAreas || []).map(area => <span key={area} className="text-sm font-semibold bg-blue-900/50 text-blue-300 px-2 py-1 rounded">{area}</span>)}</div>
                        </div>
                         {dietarySummary.length > 0 && 
                            <div className="mt-2 text-left">
                                <div className="flex items-center gap-2">
                                    <h4 className="text-xs text-gray-500 flex-shrink-0">Dietary</h4>
                                    <div className="flex flex-wrap gap-2">
                                        {dietarySummary.map(([key, count]) => <span key={key} className="text-sm font-semibold bg-amber-900/50 text-amber-300 px-2 py-1 rounded">{DIETARY_OPTIONS[key]} {count}</span>)}
                                    </div>
                                </div>
                            </div>
                        }
                    </div>
                </div>
                <div className="flex items-start gap-4 flex-shrink-0">
                    {hasFoodPackage && (<div className="flex flex-col gap-2"><div className="bg-gray-700/50 px-3 py-1 rounded-md text-center"><p className="font-bold text-lg">{totalPizzas} / {pizzaEstimate}</p><p className="text-xs text-gray-400">Pizzas</p></div><div className="bg-gray-700/50 px-3 py-1 rounded-md text-center"><p className="font-bold text-lg">{totalSnacks} / {snackEstimate}</p><p className="text-xs text-gray-400">Snacks</p></div></div>)}
                    <div className="flex flex-col gap-2">
                        <div className="flex gap-2"><StatusButton label="BRIEF" active={brief}/><StatusButton label="CHECK" active={chkd}/><StatusButton label="FOOD" active={food}/></div>
                        <div className="flex gap-2"><StatusButton label="PAID" active={paid}/><StatusButton label="DONE" active={done}/></div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatusButton = ({ label, active }) => {
    const baseClasses = "w-16 h-10 flex items-center justify-center rounded-md text-xs font-bold transition-all duration-200 leading-tight text-center";
    const activeClasses = "bg-green-500 text-white shadow-lg";
    const inactiveClasses = "bg-gray-600 text-gray-300";
    return <div className={`${baseClasses} ${active ? activeClasses : inactiveClasses}`}>{label}</div>;
};

const FoodManagementModal = ({ isOpen, onClose, foodItems, onAdd, onDelete }) => {
    const [newItemName, setNewItemName] = useState("");
    const [category, setCategory] = useState("pizzas");
    if (!isOpen) return null;

    const handleAdd = () => {
        onAdd(category, newItemName);
        setNewItemName("");
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50"><div className="bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-lg border border-gray-700"><h2 className="text-2xl font-bold mb-4">Edit Food Menu</h2><div className="flex gap-2 mb-4"><select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-gray-800 border border-gray-700 rounded-lg p-2 text-white"><option value="pizzas">Pizzas</option><option value="snacks">Snacks</option></select><input type="text" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="New item name" className="flex-grow bg-gray-800 border border-gray-700 rounded-lg p-2 text-white"/><button onClick={handleAdd} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-3 rounded-lg"><PlusCircleIcon className="w-6 h-6"/></button></div><div className="grid grid-cols-2 gap-4 max-h-60 overflow-y-auto"><div><h3 className="font-semibold text-lg mb-2">Pizzas</h3><div className="space-y-2">{Object.entries(foodItems.pizzas).map(([key, name]) => (<div key={key} className="flex justify-between items-center bg-gray-800 p-2 rounded-lg"><span>{name}</span><button onClick={() => onDelete('pizzas', key)} className="text-gray-500 hover:text-red-500"><Trash2Icon className="w-5 h-5"/></button></div>))}</div></div><div><h3 className="font-semibold text-lg mb-2">Snacks</h3><div className="space-y-2">{Object.entries(foodItems.snacks).map(([key, name]) => (<div key={key} className="flex justify-between items-center bg-gray-800 p-2 rounded-lg"><span>{name}</span><button onClick={() => onDelete('snacks', key)} className="text-gray-500 hover:text-red-500"><Trash2Icon className="w-5 h-5"/></button></div>))}</div></div></div><button onClick={onClose} className="mt-6 w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded-lg">Done</button></div></div>
    );
};
