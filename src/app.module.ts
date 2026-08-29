import { Module } from '@nestjs/common';
import { AccountsModule } from './accounts/accounts.module';
import { BeneficiariesModule } from './beneficiaries/beneficiaries.module';
import { CategoriesModule } from './categories/categories.module';
import { CreditCardsModule } from './credit-cards/credit-cards.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { GoalsModule } from './goals/goals.module';
import { ImportsModule } from './imports/imports.module';
import { PluggyModule } from './pluggy/pluggy.module';
import { InvestmentsModule } from './investments/investments.module';
import { PayeesModule } from './payees/payees.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectionModule } from './projection/projection.module';
import { RecurringRulesModule } from './recurring-rules/recurring-rules.module';
import { TransactionsModule } from './transactions/transactions.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AccountsModule,
    CategoriesModule,
    PayeesModule,
    BeneficiariesModule,
    TransactionsModule,
    DashboardModule,
    CreditCardsModule,
    RecurringRulesModule,
    ProjectionModule,
    GoalsModule,
    InvestmentsModule,
    ImportsModule,
    PluggyModule
  ]
})
export class AppModule {}
