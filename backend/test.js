async function runMentalistSimulation() {
  const response = await fetch('http://localhost:5000/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentCommitments: [
        { title: 'الدراسة الجامعية', hours_per_week: 35, intensity: 'high', timeSlot: 'morning', flexible: false },
        { title: 'التمرين والرياضة', hours_per_week: 10, intensity: 'medium', timeSlot: 'afternoon', flexible: true },
        { title: 'تطوير مشاريع برمجة', hours_per_week: 25, intensity: 'high', timeSlot: 'evening', flexible: true }
      ],
      newCommitment: { 
        title: 'عقد عمل حر جديد', 
        hours_per_week: 20, 
        intensity: 'high', 
        timeSlot: 'late_night', 
        flexible: false 
      }
    })
  });

  const data = await response.json();
  console.log('=== 🔍 استنتاجات محقق TAWAZUN-OS ===\n');
  console.log('مستوى الخطر:', data.simulation_results.burnout_risk);
  console.log('الرؤية الرئيسية:', data.simulation_results.main_insight);
  console.log('\nالملاحظات والاستنتاجات السلوكية:');
  data.simulation_results.deductions.forEach((d, i) => console.log(`${i + 1}. ${d}`));
}

runMentalistSimulation();